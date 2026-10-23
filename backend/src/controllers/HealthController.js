// Health checks for monitoring tools (Render, K8s, etc.)

import { isDatabaseConnected } from '../config/database.js';
import { isRedisConnected } from '../config/redis.js';
import { getContainer } from '../di/container.js';

export class HealthController {
    // Basic liveness check - just returns 200 if server is running
    async health(req, res) {
        const container = getContainer();
        const aiEnabled = container.isAIEnabled();

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
            features: {
                ai: aiEnabled,
            }
        });
    }

    // Detailed readiness check - verifies all dependencies are connected
    async readiness(req, res) {
        const container = getContainer();
        const aiEnabled = container.isAIEnabled();
        const aiStreamHandler = container.getAIStreamHandler();

        const checks = {
            database: isDatabaseConnected(),
            redis: isRedisConnected(),
            ai: {
                enabled: aiEnabled,
                websocket: aiStreamHandler !== null,
                jobQueue: container.get('aiJobQueue') !== null
            }
        };

        // Only DB is required — Redis is optional (falls back to in-memory)
        const isReady = checks.database;
        const statusCode = isReady ? 200 : 503;

        res.status(statusCode).json({
            status: isReady ? 'ready' : 'not_ready',
            checks,
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