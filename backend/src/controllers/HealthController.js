// Health checks for monitoring tools (Render, K8s, Uptime monitors, Docker)

import mongoose from 'mongoose';
import { isDatabaseConnected } from '../config/database.js';
import { checkRedisHealth } from '../config/redis.js';
import { isRabbitMQConnected } from '../config/rabbitmq.js';
import { config } from '../config/environment.js';
import { getContainer } from '../di/container.js';

const TIMEOUT_MS = 2000;

const withTimeout = (promise, ms = TIMEOUT_MS, fallback = null) => {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
};

export class HealthController {
    // Ultra-lightweight liveness check - verifies the process is running and event loop is responsive
    async liveness(req, res) {
        return res.status(200).json({
            status: 'live',
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.floor(process.uptime()),
            requestId: req.requestId,
        });
    }

    // Full diagnostic health check - verifies process liveness and reports dependency status with real tests
    async health(req, res) {
        const container = getContainer();
        const aiEnabled = container.isAIEnabled();
        const socketManager = container.getSocketManager();
        const wsReady = socketManager ? socketManager.isReady() : false;

        // 1. Database check (MongoDB) with timeout
        const isDbConn = isDatabaseConnected();
        let dbStatus = isDbConn ? 'connected' : 'disconnected';
        if (isDbConn && mongoose.connection.readyState === 1) {
            try {
                const dbPing = await withTimeout(
                    mongoose.connection.db.admin().ping().then(() => true).catch(() => false),
                    TIMEOUT_MS,
                    false
                );
                dbStatus = dbPing ? 'connected' : 'degraded';
            } catch {
                dbStatus = 'degraded';
            }
        }

        // 2. Redis check with real write test (SET + DEL with TTL) and timeout
        const redisHealth = await withTimeout(
            checkRedisHealth(TIMEOUT_MS),
            TIMEOUT_MS,
            { status: 'timeout', writeable: false }
        );

        let redisStatus = 'disconnected (in-memory fallback)';
        if (redisHealth.status === 'connected' && redisHealth.writeable) {
            redisStatus = 'connected';
        } else if (redisHealth.status === 'connected' && !redisHealth.writeable) {
            redisStatus = 'degraded (read-only/MISCONF)';
        } else if (redisHealth.status === 'error') {
            redisStatus = `degraded (${redisHealth.error || 'write failed'})`;
        }

        // 3. RabbitMQ check
        const rmqConnected = isRabbitMQConnected();
        const rmqStatus = rmqConnected ? 'connected' : 'disconnected';

        // 4. Vector Store status
        const ragController = container.get('ragController');
        let vectorStoreStatus = 'disabled';
        if (ragController?.ragService?.vectorStore?.qdrantStore) {
            const qdrantHealth = await withTimeout(
                ragController.ragService.vectorStore.qdrantStore.checkHealth().catch(() => ({ status: 'unreachable' })),
                TIMEOUT_MS,
                { status: 'timeout' }
            );
            vectorStoreStatus = qdrantHealth.status === 'ready' || qdrantHealth.status === 'ok' ? 'connected' : 'fallback_mongo';
        }

        // Overall status determination
        let overallStatus = 'healthy';
        let httpStatus = 200;

        if (dbStatus !== 'connected') {
            overallStatus = 'unhealthy';
            httpStatus = 503;
        } else if (redisStatus !== 'connected' || rmqStatus !== 'connected') {
            overallStatus = 'degraded';
            httpStatus = 200;
        }

        return res.status(httpStatus).json({
            status: overallStatus,
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.floor(process.uptime()),
            requestId: req.requestId,
            infrastructure: {
                database: dbStatus,
                redis: redisStatus,
                websocket: wsReady ? 'active' : 'inactive',
                messageQueue: rmqStatus,
                vectorStore: vectorStoreStatus,
            },
            features: {
                ai: aiEnabled,
                rag: ragController !== null,
                metrics: config.features?.metricsCollection ?? true,
            }
        });
    }

    // Detailed readiness check - verifies all mandatory and optional dependencies
    async readiness(req, res) {
        const container = getContainer();
        const aiEnabled = container.isAIEnabled();
        const aiStreamHandler = container.getAIStreamHandler();
        const aiJobQueue = container.get('aiJobQueue');
        const socketManager = container.getSocketManager();

        const isDbReady = isDatabaseConnected();
        const redisHealth = await withTimeout(
            checkRedisHealth(TIMEOUT_MS),
            TIMEOUT_MS,
            { status: 'timeout', writeable: false }
        );
        const isRedisReady = redisHealth.status === 'connected' && redisHealth.writeable;
        const isWsReady = socketManager ? socketManager.isReady() : false;
        const isRmqReady = isRabbitMQConnected();
        const isAiQueueReady = aiJobQueue ? aiJobQueue.isConnected : false;

        const checks = {
            database: isDbReady,
            redis: isRedisReady,
            websocket: isWsReady,
            messageQueue: isRmqReady,
            ai: {
                enabled: aiEnabled,
                websocket: aiStreamHandler !== null,
                jobQueue: isAiQueueReady
            }
        };

        const mandatory = {
            database: isDbReady,
        };

        const optionalFeatures = {
            ai: {
                enabled: aiEnabled,
                websocket: aiStreamHandler !== null,
                jobQueue: isAiQueueReady,
            },
            redisCache: isRedisReady,
            messageQueue: isRmqReady,
            rag: container.get('ragController') !== null,
        };

        const isReady = mandatory.database;
        const statusCode = isReady ? 200 : 503;

        return res.status(statusCode).json({
            status: isReady ? 'ready' : 'not_ready',
            checks,
            mandatory,
            optionalFeatures,
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
        });
    }

    // Ultra-fast lightweight ping endpoint for cron jobs & uptime monitors
    async ping(req, res) {
        return res.status(200).json({
            status: 'ok',
            message: 'Global_Fit_Ulttra backend is active',
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.floor(process.uptime()),
            requestId: req.requestId,
        });
    }
}

export default HealthController;