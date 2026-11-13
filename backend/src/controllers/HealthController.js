// Health checks for monitoring tools (Render, K8s, Uptime monitors)

import { isDatabaseConnected } from '../config/database.js';
import { isRedisConnected } from '../config/redis.js';
import { isRabbitMQConnected } from '../config/rabbitmq.js';
import { config } from '../config/environment.js';
import { getContainer } from '../di/container.js';

export class HealthController {
    // Basic liveness check - verifies process liveness and reports dependency status
    async health(req, res) {
        const container = getContainer();
        const aiEnabled = container.isAIEnabled();
        const dbConnected = isDatabaseConnected();
        const redisConnected = isRedisConnected();
        const socketManager = container.getSocketManager();
        const wsReady = socketManager ? socketManager.isReady() : false;
        const rmqConnected = isRabbitMQConnected();

        res.status(200).json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.floor(process.uptime()),
            requestId: req.requestId,
            infrastructure: {
                database: dbConnected ? 'connected' : 'disconnected',
                redis: redisConnected ? 'connected' : 'disconnected (in-memory fallback)',
                websocket: wsReady ? 'active' : 'inactive',
                messageQueue: rmqConnected ? 'connected' : 'disconnected',
            },
            features: {
                ai: aiEnabled,
                rag: container.get('ragController') !== null,
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
        const isRedisReady = isRedisConnected();
        const isWsReady = socketManager ? socketManager.isReady() : false;
        const isRmqReady = isRabbitMQConnected();
        const isAiQueueReady = aiJobQueue ? aiJobQueue.isConnected : false;

        // Structured checks preserving exact backward compatibility while exposing infrastructure health
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

        // Clear distinction between mandatory dependencies and optional features
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

        // Rule: Mandatory dependencies must be satisfied before application reports ready
        // MongoDB is mandatory; Redis, RabbitMQ and AI gracefully degrade
        const isReady = mandatory.database;
        const statusCode = isReady ? 200 : 503;

        res.status(statusCode).json({
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
        res.status(200).json({
            status: 'ok',
            message: 'Global_Fit_Ulttra backend is active',
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.floor(process.uptime()),
            requestId: req.requestId,
        });
    }
}

export default HealthController;