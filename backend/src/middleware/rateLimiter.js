// Rate limiting - protects API from abuse with tiered limits
// Auth: 5/15min, Public: 100/15min, Authenticated: 1000/15min, AI: 10/1min, Admin: 20/15min

import rateLimit, { MemoryStore } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { config } from '../config/environment.js';
import { logger } from '../config/logger.js';
import { getRedisClient } from '../config/redis.js';

const FIFTEEN_MINUTES_MS = config.security.rateLimitWindowMs || 15 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

/**
 * Resilient rate-limit store that dynamically delegates to RedisStore
 * when Redis is connected and healthy, falling back seamlessly to MemoryStore.
 */
class ResilientRateLimitStore {
    constructor(prefix) {
        this.prefix = prefix;
        this.memoryStore = new MemoryStore();
        this.redisStore = null;
        this.options = null;
    }

    init(options) {
        this.options = options;
        if (typeof this.memoryStore.init === 'function') {
            this.memoryStore.init(options);
        }
    }

    _getActiveStore() {
        const client = getRedisClient();
        if (client && client.status === 'ready') {
            if (!this.redisStore) {
                try {
                    this.redisStore = new RedisStore({
                        sendCommand: (...args) => client.call(...args),
                        prefix: `rl:${this.prefix}:`,
                    });
                    if (this.options && typeof this.redisStore.init === 'function') {
                        this.redisStore.init(this.options);
                    }
                } catch (e) {
                    logger.warn('Failed to initialize RedisStore for rate limiter, using MemoryStore', { error: e.message });
                    return this.memoryStore;
                }
            }
            return this.redisStore;
        }
        return this.memoryStore;
    }

    async increment(key) {
        try {
            return await this._getActiveStore().increment(key);
        } catch (err) {
            logger.warn('Rate limit increment failed on active store, falling back to memory', { error: err.message });
            return this.memoryStore.increment(key);
        }
    }

    async decrement(key) {
        try {
            return await this._getActiveStore().decrement(key);
        } catch (err) {
            return this.memoryStore.decrement(key);
        }
    }

    async resetKey(key) {
        try {
            return await this._getActiveStore().resetKey(key);
        } catch (err) {
            return this.memoryStore.resetKey(key);
        }
    }

    async resetAll() {
        if (typeof this._getActiveStore().resetAll === 'function') {
            return this._getActiveStore().resetAll();
        }
    }
}

// Helper: prefer user ID over IP for authenticated requests
const createHybridKeyGenerator = (prefix) => {
    return (req) => {
        const identifier = req.user?.userId || req.user?.id || req.ip;
        return `${prefix}:${identifier}`;
    };
};

// Helper: log and respond when rate limit exceeded
const createLimitHandler = (context) => {
    return (req, res, next, options) => {
        logger.warn(`${context} rate limit exceeded`, {
            ip: req.ip,
            path: req.path,
            method: req.method,
            requestId: req.requestId,
            userId: req.user?.userId || req.user?.id || 'anonymous',
        });
        res.status(429).json(options.message);
    };
};

// Auth rate limiter - 5 requests per 15 minutes (prevents brute force)
export const authRateLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    max: 5,
    message: {
        error: {
            code: 'E1013',
            message: 'Too many authentication attempts. Please try again in 15 minutes.',
            retryAfter: Math.ceil(FIFTEEN_MINUTES_MS / 1000),
        },
    },
    standardHeaders: true,   // Send `RateLimit-*` headers (RFC standard)
    legacyHeaders: false,    // Disable deprecated `X-RateLimit-*` headers
    keyGenerator: (req) => req.ip,  // Always IP-based for auth (user not yet identified)
    store: new ResilientRateLimitStore('auth'),
    handler: createLimitHandler('Auth'),
});

// Global API rate limiter - 100 requests per 15 minutes
export const globalRateLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    max: config.security.rateLimitMaxRequests || 100,
    message: {
        error: {
            code: 'E1002',
            message: 'Too many requests, please try again later.',
            retryAfter: Math.ceil(FIFTEEN_MINUTES_MS / 1000),
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRateLimitStore('global'),
    handler: createLimitHandler('Global'),
});

// Authenticated user rate limiter - 1000 requests per 15 minutes
export const authenticatedUserRateLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    max: 1000,
    message: {
        error: {
            code: 'E1014',
            message: 'Request limit exceeded for your account. Please try again later.',
            retryAfter: Math.ceil(FIFTEEN_MINUTES_MS / 1000),
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: createHybridKeyGenerator('user'),
    store: new ResilientRateLimitStore('user'),
    handler: createLimitHandler('Authenticated User'),
});

// Admin rate limiter - 20 requests per 15 minutes
export const adminRateLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    max: 20,
    message: {
        error: {
            code: 'E1002',
            message: 'Too many admin requests, please try again later.',
            retryAfter: Math.ceil(FIFTEEN_MINUTES_MS / 1000),
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: createHybridKeyGenerator('admin'),
    store: new ResilientRateLimitStore('admin'),
    handler: createLimitHandler('Admin'),
});

// AI rate limiter - 10 requests per 1 minute (AI calls are expensive)
export const aiRateLimiter = rateLimit({
    windowMs: ONE_MINUTE_MS,
    max: 10,
    message: {
        error: {
            code: 'E1012',
            message: 'AI rate limit exceeded. Maximum 10 AI requests per minute.',
            retryAfter: 60,
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: createHybridKeyGenerator('ai'),
    store: new ResilientRateLimitStore('ai'),
    handler: createLimitHandler('AI'),
});

// Health check rate limiter - 1000 requests per 1 minute (very lenient)
export const healthRateLimiter = rateLimit({
    windowMs: ONE_MINUTE_MS,
    max: 1000,
    message: {
        error: {
            code: 'E1002',
            message: 'Too many health check requests.',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
});

export default globalRateLimiter;
