/**
 * Global_Fit_Ulttra - Server Bootstrap
 *
 * This is the application entry point. It is responsible ONLY for:
 * 1. Connecting to MongoDB, Redis, and RabbitMQ
 * 2. Creating the HTTP server and Socket.io instance
 * 3. Initializing the DI container
 * 4. Delegating Express app + route setup to app.js
 * 5. Registering graceful shutdown handlers
 * 6. Starting the HTTP server
 *
 * Express app creation and route mounting live in app.js.
 * This keeps server.js focused purely on infrastructure bootstrap.
 *
 * Startup Sequence:
 * ─────────────────────────────────────────────────────────────────
 * 1. MongoDB (required) — App exits if connection fails
 * 2. Redis (optional)   — Falls back to in-memory if unavailable
 * 3. RabbitMQ (optional)— AI job queue disabled if unavailable
 * 4. Express app creation + middleware pipeline  [via app.js]
 * 5. HTTP server + Socket.io initialization
 * 6. DI container initialization (creates all service instances)
 * 7. Route mounting                              [via app.js]
 * 8. Graceful shutdown handler registration
 * 9. HTTP server starts listening
 *
 * Graceful Shutdown:
 * On SIGTERM/SIGINT, connections close in reverse order:
 * HTTP → Socket.io → AI job queue → MongoDB → Redis → RabbitMQ
 * Force-exits after 15 seconds if graceful shutdown stalls.
 *
 * @module server
 */

import './src/utils/polyfills.js';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';

import {
    config,
    logger,
    connectDatabase,
    closeDatabaseConnection,
    connectRedis,
    closeRedisConnection,
    connectRabbitMQ,
    closeRabbitMQConnection,
    flushLogger,
    safeLog,
} from './src/config/index.js';
import { getContainer } from './src/di/container.js';
import { createApp, setupRoutes } from './src/app.js';  // ← imported from src/app.js

/**
 * Register graceful shutdown handlers for clean process termination.
 *
 * Shutdown Order:
 * 1. Await server.close() — drain active HTTP keep-alive connections first
 * 2. Close Socket.io connections
 * 3. Close AI job queue (RabbitMQ consumer)
 * 4. Close MongoDB connection
 * 5. Close Redis connection
 * 6. Close RabbitMQ connection
 * 7. Flush Winston logger buffers
 *
 * Safety: Force-exits after 15 seconds if graceful shutdown stalls.
 * Uses `isShuttingDown` flag to prevent duplicate shutdown attempts.
 *
 * @param {import('http').Server} server - Node.js HTTP server
 * @param {import('./di/container.js').Container} container - DI container
 */
const setupGracefulShutdown = (server, container) => {
    let isShuttingDown = false;

    const shutdown = async (signal) => {
        // Prevent duplicate shutdown (e.g., SIGTERM followed by SIGINT)
        if (isShuttingDown) return;
        isShuttingDown = true;

        logger.info(`${signal} received, starting graceful shutdown`);

        // Force-exit safety net: kills process after 15 seconds
        const forceShutdownTimer = setTimeout(() => {
            console.error('Forced shutdown after timeout');
            process.exit(1);
        }, 15000);

        try {
            // Wrapped in Promise so active HTTP keep-alive connections
            // fully drain BEFORE tearing down MongoDB/Redis underneath.
            await new Promise((resolve) => server.close(resolve));
            safeLog('info', 'HTTP server closed');

            // 1. Socket.io — stop WebSocket connections
            const socketManager = container.getSocketManager();
            if (socketManager) {
                await socketManager.close();
                safeLog('info', 'Socket.io closed');
            }

            // Stop keep-alive background task
            const keepAliveService = container.get('keepAliveService');
            if (keepAliveService) {
                keepAliveService.stop();
                safeLog('info', 'KeepAlive service stopped');
            }

            // 2. AI job queue — stop consuming RabbitMQ messages
            await container.closeAIJobQueue();
            safeLog('info', 'AI job queue closed');

            // 3. MongoDB — close connection pool
            await closeDatabaseConnection();
            safeLog('info', 'MongoDB connection closed');

            // 4. Redis — close connection (may already be disconnected)
            try {
                await closeRedisConnection();
                safeLog('info', 'Redis connection closed');
            } catch (error) {
                safeLog('warn', 'Redis already disconnected or not available');
            }

            // 5. RabbitMQ — close AMQP connection
            await closeRabbitMQConnection();
            safeLog('info', 'RabbitMQ connection closed');

            // 6. Flush logger — ensure all log entries are written to disk
            await flushLogger();
            console.log('Graceful shutdown complete');

            clearTimeout(forceShutdownTimer);
            process.exit(0);
        } catch (error) {
            console.error('Error during shutdown', error.message);
            clearTimeout(forceShutdownTimer);
            process.exit(1);
        }
    };

    // Register signal handlers
    process.on('SIGTERM', () => shutdown('SIGTERM')); // Render.com, Docker, systemd
    process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C in terminal

    // Fast exit on uncaught exception — log and let process manager restart.
    // Do NOT run full shutdown here: DB writes may be mid-flight and shutdown
    // itself can throw, masking the original error.
    process.on('uncaughtException', (error) => {
        console.error('='.repeat(60));
        console.error('❌ UNCAUGHT EXCEPTION — process will exit');
        console.error('='.repeat(60));
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('='.repeat(60));
        process.exit(1);
    });

    // Fast exit on unhandled rejection — Node.js 20+ crashes by default anyway.
    // Overriding without exiting leaves the app in a broken silent state.
    process.on('unhandledRejection', (reason) => {
        console.error('='.repeat(60));
        console.error('❌ UNHANDLED REJECTION — process will exit');
        console.error('='.repeat(60));
        console.error('Reason:', String(reason));
        console.error('='.repeat(60));
        process.exit(1);
    });
};

/**
 * Main startup function — orchestrates the entire application bootstrap.
 *
 * Exits with code 1 if MongoDB connection fails (required dependency).
 * Redis and RabbitMQ failures are logged as warnings but don't block startup.
 *
 * @returns {Promise<void>}
 */
const startServer = async () => {
    try {
        logger.info('Starting Global_Fit_Ulttra...');

        // Log environment details in development mode
        if (config.server.isDev) {
            logger.debug('Environment check', {
                nodeEnv: config.server.nodeEnv,
                port: config.server.port,
                groqKeyConfigured: !!config.ai.groqApiKey && config.ai.groqApiKey.length > 0,
                groqKeyLength: config.ai.groqApiKey?.length || 0,
                redisConfigured: !!config.redis.url,
                mongoConfigured: !!config.database.uri,
            });
        }

        // ─── Step 1: Connect to MongoDB (REQUIRED) ──────────────────
        await connectDatabase();

        // ─── Step 2: Connect to Redis (OPTIONAL) ────────────────────
        try {
            const redisConnected = await connectRedis();
            if (redisConnected) {
                logger.info('✅ Redis connected - caching enabled');
            } else {
                logger.warn('⚠️ Redis not available - running without cache');
                logger.info('ℹ️  Impact: Rate limiting and caching will use in-memory fallbacks');
            }
        } catch (error) {
            logger.warn('⚠️ Redis connection failed - continuing without cache', {
                error: error.message,
                impact: 'Rate limiting and caching will use in-memory fallbacks',
            });
        }

        // ─── Step 3: Connect to RabbitMQ (OPTIONAL) ─────────────────
        try {
            await connectRabbitMQ();
        } catch (error) {
            logger.warn('RabbitMQ not available - running without message queue', {
                error: error.message,
                impact: 'AI job queue and async processing will be disabled',
            });
        }

        // ─── Step 4: Create Express App (via app.js) ─────────────────
        const app = createApp();
        const httpServer = createServer(app);

        // ─── Step 5: Create Socket.io Server ────────────────────────
        const io = new SocketIOServer(httpServer, {
            cors: {
                origin: config.socketIo.corsOrigins,
                methods: ['GET', 'POST'],
                credentials: true,
            },
            pingTimeout: 60000, // 60s before considering a client disconnected
            pingInterval: 25000, // 25s heartbeat interval
            maxHttpBufferSize: 1e6, // 1MB payload ceiling prevents memory exhaustion DoS
        });

        // ─── Socket.io Handshake Authentication Middleware ───────────
        io.use((socket, next) => {
            const token = socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

            if (!token) {
                return next(new Error('Authentication error: Missing authentication token'));
            }

            try {
                const secret = config.security?.jwtAccessSecret || config.auth?.jwtAccessSecret;
                const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });

                if (decoded.tokenType === 'refresh') {
                    return next(new Error('Authentication error: Refresh tokens cannot be used for WebSocket connections'));
                }

                socket.user = {
                    userId: decoded.userId || decoded.id,
                    role: decoded.role || 'Member',
                    organizationId: decoded.organizationId || null,
                    email: decoded.email,
                };
                next();
            } catch (err) {
                return next(new Error('Authentication error: Invalid or expired token'));
            }
        });

        // ─── Step 6: Initialize DI Container ────────────────────────
        const container = getContainer();
        await container.initialize({ io });

        // ─── Step 7: Mount Routes (via app.js) ──────────────────────
        setupRoutes(app, container);

        // ─── Step 8: Register Shutdown Handlers ─────────────────────
        setupGracefulShutdown(httpServer, container);

        // ─── Step 9: Start Listening ────────────────────────────────
        // Binding to '0.0.0.0' ensures external traffic reaches the server on Render & Docker
        const host = (config.server.isProd && (config.server.host === 'localhost' || config.server.host === '127.0.0.1'))
            ? '0.0.0.0'
            : (config.server.host || '0.0.0.0');
        const port = Number(process.env.PORT) || config.server.port || 4000;

        httpServer.listen(port, host, () => {
            logger.info(`🚀 Global_Fit_Ulttra running on http://${host}:${port}`);
            logger.info(`   Environment: ${config.server.nodeEnv}`);
            logger.info(`   Health check: http://${host}:${port}/api/v1/health`);

            if (container.isAIEnabled()) {
                logger.info(`   ✅ AI Features: ENABLED`);
                logger.info(`   🤖 AI Endpoints: http://${host}:${port}/api/v1/ai/*`);
                logger.info(`   🔌 AI WebSocket: ws://${host}:${port}`);
            } else {
                logger.info(`   ℹ️  AI Features: DISABLED (configure GROQ_API_KEY to enable)`);
            }

            // Start KeepAlive background ping service if configured
            const keepAliveService = container.get('keepAliveService');
            if (keepAliveService) {
                keepAliveService.start();
            }
        });

    } catch (error) {
        logger.error('Failed to start server', { error: error.message, stack: error.stack });
        process.exit(1);
    }
};

// ─── Application Entry Point ─────────────────────────────────────────────────
startServer();