// Redis client setup with reconnection logic

import Redis from 'ioredis';
import { config } from './environment.js';
import { logger } from './logger.js';

let redisClient = null;
let isRedisAvailable = false;

export const createRedisClient = () => {
    if (redisClient) {
        return redisClient;
    }

    if (!config.redis.url) {
        logger.warn('⚠️ REDIS_URL not configured - Redis features will be disabled');
        return null;
    }

    const options = {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        enableReadyCheck: true,
        lazyConnect: true,
        retryStrategy(times) {
            if (times > 3) {
                logger.warn('⚠️ Redis max retries reached - disabling Redis');
                return null;
            }
            const delay = Math.min(times * 50, 2000);
            return delay;
        },
    };

    if (config.redis.password) {
        options.password = config.redis.password;
    }

    if (config.redis.url.startsWith('rediss://')) {
        options.tls = { rejectUnauthorized: false };
    }

    redisClient = new Redis(config.redis.url, options);

    redisClient.on('connect', () => {
        logger.info('✅ Redis client connected');
    });

    redisClient.on('ready', () => {
        isRedisAvailable = true;
        logger.info('✅ Redis client ready');
    });

    redisClient.on('error', (err) => {
        isRedisAvailable = false;
        logger.error('❌ Redis client error', { error: err.message || String(err) });
    });

    redisClient.on('close', () => {
        isRedisAvailable = false;
        logger.warn('⚠️ Redis connection closed');
    });

    redisClient.on('reconnecting', (time) => {
        logger.info(`🔄 Redis reconnecting in ${time}ms`);
    });

    return redisClient;
};

export const connectRedis = async () => {
    const isProduction = config.server.isProd;
    const isLocalhostRedis = !config.redis.url || config.redis.url.includes('localhost') || config.redis.url.includes('127.0.0.1');

    if (isProduction && isLocalhostRedis) {
        logger.warn('⚠️ REDIS_URL not configured for production environment - running without Redis cache');
        logger.info('ℹ️  Impact: Rate limiting and caching will use in-memory fallbacks');
        return null;
    }

    if (!config.redis.url) {
        logger.warn('⚠️ REDIS_URL not set - running without cache');
        return null;
    }

    const client = createRedisClient();
    
    if (!client) {
        return null;
    }

    try {
        await client.connect();
        isRedisAvailable = true;
        logger.info('✅ Redis connected successfully');
        return client;
    } catch (error) {
        isRedisAvailable = false;
        logger.warn('⚠️ Failed to connect to Redis - continuing without cache', { 
            error: error.message || String(error) 
        });
        
        if (client) {
            try {
                client.disconnect(false);
            } catch (e) {
                // Ignore cleanup errors
            }
        }
        redisClient = null;
        return null;
    }
};

export const getRedisClient = () => {
    return redisClient;
};

export const closeRedisConnection = async () => {
    if (redisClient) {
        try {
            await redisClient.quit();
            logger.info('Redis connection closed gracefully');
            redisClient = null;
            isRedisAvailable = false;
        } catch (error) {
            logger.error('Error closing Redis connection', { error: error.message });
            redisClient = null;
            isRedisAvailable = false;
        }
    }
};

export const isRedisConnected = () => {
    return redisClient?.status === 'ready' && isRedisAvailable;
};

export default {
    createRedisClient,
    connectRedis,
    getRedisClient,
    closeRedisConnection,
    isRedisConnected,
};
