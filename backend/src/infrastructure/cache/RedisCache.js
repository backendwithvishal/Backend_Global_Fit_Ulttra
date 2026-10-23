// Redis cache with TTL and stale-while-revalidate pattern

import { getRedisClient } from '../../config/redis.js';
import { config } from '../../config/environment.js';
import { logger } from '../../config/logger.js';

export class RedisCache {
    constructor() {
        this.keyPrefix = 'global_fit_ulttra';
    }

    _getClient() {
        return getRedisClient();
    }

    // Build cache key with prefix
    buildKey(service, identifier) {
        return `${this.keyPrefix}:${service}:${identifier}`;
    }

    // Get cached value
    async get(key) {
        const client = this._getClient();
        if (!client) return null;

        try {
            const data = await client.get(key);
            if (!data) return null;

            const parsed = JSON.parse(data);
            logger.debug(`Cache hit: ${key}`);
            return parsed;
        } catch (error) {
            logger.error('Cache get error', { key, error: error.message });
            return null;
        }
    }

    // Set value with TTL
    async set(key, value, ttlSeconds = config.redis.ttlDefault) {
        const client = this._getClient();
        if (!client) return false;

        try {
            const data = JSON.stringify(value);
            await client.setex(key, ttlSeconds, data);
            logger.debug(`Cache set: ${key} (TTL: ${ttlSeconds}s)`);
            return true;
        } catch (error) {
            logger.error('Cache set error', { key, error: error.message });
            return false;
        }
    }

    // Delete cached value
    async delete(key) {
        const client = this._getClient();
        if (!client) return false;

        try {
            await client.del(key);
            logger.debug(`Cache delete: ${key}`);
            return true;
        } catch (error) {
            logger.error('Cache delete error', { key, error: error.message });
            return false;
        }
    }

    // Clear all cache entries
    async clear() {
        const client = this._getClient();
        if (!client) return false;

        try {
            const keys = await client.keys(`${this.keyPrefix}:*`);
            if (keys.length > 0) {
                await client.del(...keys);
                logger.info(`Cache cleared: ${keys.length} keys`);
            }
            return true;
        } catch (error) {
            logger.error('Cache clear error', { error: error.message });
            return false;
        }
    }

    // Get or set with callback (stale-while-revalidate)
    async getOrSet(key, fetchFn, ttlSeconds) {
        // Try cache first
        const cached = await this.get(key);
        if (cached) {
            return { data: cached, fromCache: true };
        }

        // Fetch fresh data
        try {
            const data = await fetchFn();
            await this.set(key, data, ttlSeconds);
            return { data, fromCache: false };
        } catch (error) {
            logger.error('Cache getOrSet fetch error', { key, error: error.message });
            throw error;
        }
    }

    // Get TTL for a service
    getTTL(service) {
        const ttlMap = {
            alpha_vantage: config.cacheTTL.alphaVantage,
            coingecko: config.cacheTTL.coinGecko,
            exchangerate_api: config.cacheTTL.exchangeRate,
            newsapi: config.cacheTTL.newsApi,
            fred: config.cacheTTL.fred,
            finnhub: config.cacheTTL.finnhub,
        };
        return ttlMap[service] || config.redis.ttlDefault;
    }
}

export default RedisCache;
