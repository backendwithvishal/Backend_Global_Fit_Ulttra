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
            currentTokens = await redis.incrby(quotaKey, estimatedTokens);
            if (currentTokens === estimatedTokens) {
                await redis.expire(quotaKey, 86400);
            }
        } else {
            const entry = memoryQuotas.get(quotaKey) || 0;
            currentTokens = entry + estimatedTokens;
            memoryQuotas.set(quotaKey, currentTokens);
        }

        if (currentTokens > maxQuota) {
            // Revert reservation if quota exceeded
            if (redis && redis.status === 'ready') {
                await redis.decrby(quotaKey, estimatedTokens);
            } else {
                memoryQuotas.set(quotaKey, currentTokens - estimatedTokens);
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
        logger.error('Error checking AI quota', { error: err.message });
        next();
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
            currentTokens = await redis.incrby(quotaKey, estimatedTokens);
            if (currentTokens === estimatedTokens) {
                await redis.expire(quotaKey, 86400);
            }
        } else {
            const entry = memoryQuotas.get(quotaKey) || 0;
            currentTokens = entry + estimatedTokens;
            memoryQuotas.set(quotaKey, currentTokens);
        }

        if (currentTokens > maxQuota) {
            if (redis && redis.status === 'ready') {
                await redis.decrby(quotaKey, estimatedTokens);
            } else {
                memoryQuotas.set(quotaKey, currentTokens - estimatedTokens);
            }
            return false;
        }
        return true;
    } catch (err) {
        logger.error('Error checking socket AI quota', { error: err.message });
        return true;
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
            const newTotal = await redis.incrby(quotaKey, tokensUsed);
            if (newTotal === tokensUsed) {
                await redis.expire(quotaKey, 86400);
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
 * Ensures the model treats the content as data, not instruction.
 */
export const sanitizeForPrompt = (untrustedText) => {
    if (!untrustedText || typeof untrustedText !== 'string') return '';
    // Strip control characters while preserving valid newlines and spaces
    // eslint-disable-next-line no-control-regex
    const clean = untrustedText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return `<<<UNTRUSTED_DATA_START>>>\n${clean}\n<<<UNTRUSTED_DATA_END>>>`;
};

export default {
    checkAIQuota,
    recordTokenSpend,
    sanitizeForPrompt,
};
