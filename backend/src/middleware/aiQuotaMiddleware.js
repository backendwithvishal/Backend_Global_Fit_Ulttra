/**
 * Global_Fit_Ulttra - AI Quota & Input Hardening Middleware
 *
 * Enforces:
 * 1. Per-user daily token spend quota stored in Redis (with in-memory fallback)
 * 2. Hard caps on prompt length (max 4000 chars)
 * 3. Delimiter and instruction hierarchy against prompt injection
 *
 * @module middleware/aiQuotaMiddleware
 */

import { getRedisClient } from '../config/redis.js';
import { config } from '../config/environment.js';
import { logger } from '../config/logger.js';

// In-memory fallback if Redis is unavailable
const memoryQuotas = new Map();

/**
 * Gets the current daily quota key for a user.
 */
const getQuotaKey = (userId) => {
    const today = new Date().toISOString().slice(0, 10);
    return `quota:ai:${userId}:${today}`;
};

/**
 * Checks if the user has remaining daily AI token quota atomically.
 */
export const checkAIQuota = async (req, res, next) => {
    try {
        const userId = req.user?.userId || req.user?.id || req.ip;
        const maxQuota = config.ai.dailyTokenQuota || 50000;
        const maxPromptLen = config.ai.maxPromptLength || 4000;

        // 1. Cap prompt / text inputs to prevent token exhaustion DoS
        const promptText = req.body?.text || req.body?.message || req.body?.question;
        if (typeof promptText === 'string' && promptText.length > maxPromptLen) {
            return res.status(400).json({
                error: {
                    code: 'E1016',
                    message: `AI input exceeds maximum allowed length of ${maxPromptLen} characters.`,
                },
                requestId: req.requestId,
            });
        }

        // 2. Atomic quota reservation to prevent race conditions
        const quotaKey = getQuotaKey(userId);
        const redis = getRedisClient();
        const estimatedTokens = Math.max(100, Math.ceil((promptText?.length || 400) / 4));
        let currentTokens = 0;

        if (redis && redis.status === 'ready') {
            try {
                currentTokens = await redis.incrby(quotaKey, estimatedTokens);
                if (currentTokens === estimatedTokens) {
                    await redis.expire(quotaKey, 86400);
                }
            } catch (redisErr) {
                logger.warn('Redis incrby failed during AI quota check, falling back to memory quota', { error: redisErr.message });
                const entry = memoryQuotas.get(quotaKey) || 0;
                currentTokens = entry + estimatedTokens;
                memoryQuotas.set(quotaKey, currentTokens);
            }
        } else {
            const entry = memoryQuotas.get(quotaKey) || 0;
            currentTokens = entry + estimatedTokens;
            memoryQuotas.set(quotaKey, currentTokens);
        }

        if (currentTokens > maxQuota) {
            // Revert reservation if quota exceeded
            if (redis && redis.status === 'ready') {
                try {
                    await redis.decrby(quotaKey, estimatedTokens);
                } catch (_) {
                    memoryQuotas.set(quotaKey, Math.max(0, currentTokens - estimatedTokens));
                }
            } else {
                memoryQuotas.set(quotaKey, Math.max(0, currentTokens - estimatedTokens));
            }
            logger.warn('AI daily token quota exceeded', { userId, currentTokens, maxQuota });
            return res.status(429).json({
                error: {
                    code: 'E1015',
                    message: `Daily AI token quota of ${maxQuota} tokens exceeded. Quota resets at 00:00 UTC.`,
                },
                requestId: req.requestId,
            });
        }

        // Attach quota info to request
        req.aiQuota = {
            userId,
            currentTokens,
            maxQuota,
            quotaKey,
            reservedTokens: estimatedTokens,
        };

        next();
    } catch (err) {
        logger.error('Error checking AI quota - applying safe throttling', { error: err.message });
        return res.status(429).json({
            error: {
                code: 'E1015',
                message: 'AI service rate limit/quota verification temporarily unavailable. Please retry shortly.',
            },
            requestId: req.requestId,
        });
    }
};

/**
 * Checks and reserves token quota for WebSocket operations.
 */
export const checkSocketAIQuota = async (userId, estimatedTokens = 100) => {
    try {
        const maxQuota = config.ai.dailyTokenQuota || 50000;
        const quotaKey = getQuotaKey(userId);
        const redis = getRedisClient();
        let currentTokens = 0;

        if (redis && redis.status === 'ready') {
            try {
                currentTokens = await redis.incrby(quotaKey, estimatedTokens);
                if (currentTokens === estimatedTokens) {
                    await redis.expire(quotaKey, 86400);
                }
            } catch (redisErr) {
                logger.warn('Redis error in socket AI quota check, falling back to memory quota', { error: redisErr.message });
                const entry = memoryQuotas.get(quotaKey) || 0;
                currentTokens = entry + estimatedTokens;
                memoryQuotas.set(quotaKey, currentTokens);
            }
        } else {
            const entry = memoryQuotas.get(quotaKey) || 0;
            currentTokens = entry + estimatedTokens;
            memoryQuotas.set(quotaKey, currentTokens);
        }

        if (currentTokens > maxQuota) {
            if (redis && redis.status === 'ready') {
                try {
                    await redis.decrby(quotaKey, estimatedTokens);
                } catch (_) {
                    memoryQuotas.set(quotaKey, Math.max(0, currentTokens - estimatedTokens));
                }
            } else {
                memoryQuotas.set(quotaKey, Math.max(0, currentTokens - estimatedTokens));
            }
            return false;
        }
        return true;
    } catch (err) {
        logger.error('Error checking socket AI quota - failing closed', { error: err.message });
        return false;
    }
};

/**
 * Record additional tokens consumed by a user after completion of an AI call.
 */
export const recordTokenSpend = async (userId, tokensUsed = 500) => {
    try {
        const quotaKey = getQuotaKey(userId);
        const redis = getRedisClient();

        if (redis && redis.status === 'ready') {
            try {
                const newTotal = await redis.incrby(quotaKey, tokensUsed);
                if (newTotal === tokensUsed) {
                    await redis.expire(quotaKey, 86400);
                }
            } catch {
                const current = memoryQuotas.get(quotaKey) || 0;
                memoryQuotas.set(quotaKey, current + tokensUsed);
            }
        } else {
            const current = memoryQuotas.get(quotaKey) || 0;
            memoryQuotas.set(quotaKey, current + tokensUsed);
        }
    } catch (err) {
        logger.error('Failed to record token spend', { userId, error: err.message });
    }
};

/**
 * Wraps untrusted text (user prompt or external data) in safe delimiters.
 * Strips boundary marker strings from untrusted text to prevent early block closing,
 * removes non-printable control characters, and enforces strict boundary markers.
 * Note: Reduces risk of prompt injection, cannot mathematically eliminate it.
 */
export const sanitizeForPrompt = (untrustedText) => {
    if (!untrustedText || typeof untrustedText !== 'string') return '';
    // Strip control characters while preserving valid newlines and spaces
    // eslint-disable-next-line no-control-regex
    const clean = untrustedText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // Strip any boundary marker tags to prevent attackers closing delimiter early
    const stripped = clean.replace(/<<<UNTRUSTED_(?:DATA|DOCUMENT_CONTENT)_(?:START|END)>>>/gi, '');
    return `<<<UNTRUSTED_DATA_START>>>\n${stripped}\n<<<UNTRUSTED_DATA_END>>>`;
};

export default {
    checkAIQuota,
    checkSocketAIQuota,
    recordTokenSpend,
    sanitizeForPrompt,
};
