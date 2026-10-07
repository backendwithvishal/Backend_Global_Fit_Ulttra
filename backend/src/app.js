/**
 * Global-Fi Ultra - Express Application Factory
 *
 * This module is responsible for:
 * 1. Creating and configuring the Express app with the full middleware pipeline
 * 2. Mounting all API routes via setupRoutes()
 *
 * It does NOT start the HTTP server — that is handled by server.js.
 * This separation makes the app easily testable (import app without binding a port).
 *
 * Middleware execution order (top to bottom):
 * 1. `securityHeaders`    — Helmet CSP and security headers
 * 2. `corsMiddleware`     — CORS policy enforcement
 * 3. `express.json()`    — Body parsing (10KB limit to prevent abuse)
 * 4. `express.urlencoded()` — URL-encoded body parsing
 * 5. `requestIdMiddleware`  — Attach X-Request-Id to every request
 * 6. `requestLogger`     — Log request details on response finish
 * 7. API version header  — X-API-Version: 1.0.0
 * 8. `globalRateLimiter` — 100 req/15min on /api prefix
 * 9. Routes             — All API routes mounted under /api/v1/
 * 10. `notFoundHandler`  — 404 for unmatched routes
 * 11. `errorHandler`     — Centralized error handler
 *
 * @module app
 */

import express from 'express';
import { logger } from './config/index.js';
import {
    requestIdMiddleware,
    globalRateLimiter,
    errorHandler,
    notFoundHandler,
    securityHeaders,
    corsMiddleware,
    requestLogger,
} from './middleware/index.js';
import {
    createHealthRoutes,
    createFinancialRoutes,
    createAdminRoutes,
    createStatusRoutes,
    createUserRoutes,
    createWatchlistRoutes,
    createAlertRoutes,
    createAssetRoutes,
    createAuthRoutes,
    createOrganizationRoutes,
    createBillingRoutes,
    createApiKeyRoutes,
} from './routes/index.js';
import { createAIRoutes } from './routes/aiRoutes.js';

/**
 * Creates and configures the Express application with the full middleware pipeline.
 *
 * @returns {express.Application} Configured Express application
 */
export const createApp = () => {
    const app = express();

    // Enable trust for the first reverse proxy (Render.com, Nginx, etc.)
    // Required for accurate client IP in rate limiting and logging
    app.set('trust proxy', 1);

    // ─── Security Layer ──────────────────────────────────────────────
    app.use(securityHeaders);  // Helmet: CSP, HSTS, X-Frame-Options, etc.
    app.use(corsMiddleware);   // CORS: whitelist allowed origins

    // ─── Request Parsing ─────────────────────────────────────────────
    // 10KB limit prevents large payload attacks (DoS via oversized JSON)
    app.use(express.json({ limit: '10kb' }));
    app.use(express.urlencoded({ extended: true, limit: '10kb' }));

    // ─── Tracing & Logging ───────────────────────────────────────────
    app.use(requestIdMiddleware); // Attach unique X-Request-Id for distributed tracing
    app.use(requestLogger);       // Log method, path, status, duration on every response

    // ─── API Versioning ──────────────────────────────────────────────
    // Set version header for all responses (helps clients detect API changes)
    app.use((req, res, next) => {
        res.setHeader('X-API-Version', '1.0.0');
        next();
    });

    // ─── Rate Limiting ───────────────────────────────────────────────
    // Global rate limit: 100 requests per 15 minutes, applied to all /api/** routes
    app.use('/api', globalRateLimiter);

    // ─── Root Route ──────────────────────────────────────────────────
    app.get('/', (req, res) => {
        res.json({
            name: 'Global-Fi Ultra API',
            version: '1.0.0',
            status: 'running',
            docs: {
                health:    '/api/v1/health',
                readiness: '/api/v1/health/readiness',
                financial: '/api/v1/financial',
                ai:        '/api/v1/ai',
            },
        });
    });

    return app;
};

/**
 * Mount all API routes onto the Express app.
 *
 * Route Hierarchy:
 * ─────────────────────────────────────────────────────────────────
 * | Path                 | Controller            | Rate Limiter     |
 * |----------------------|-----------------------|------------------|
 * | /health, /api/v1/health | HealthController   | healthRateLimiter|
 * | /api/v1/financial    | FinancialController   | globalRateLimiter|
 * | /api/v1/admin        | AdminController       | adminRateLimiter |
 * | /api/v1/status       | StatusController      | globalRateLimiter|
 * | /api/v1/users        | UserController        | authenticatedUser|
 * | /api/v1/watchlists   | WatchlistController   | authenticatedUser|
 * | /api/v1/alerts       | AlertController       | authenticatedUser|
 * | /api/v1/assets       | AssetController       | authenticatedUser|
 * | /api/v1/ai           | AIController (opt.)   | aiRateLimiter    |
 * ─────────────────────────────────────────────────────────────────
 *
 * @param {express.Application} app - The Express application
 * @param {import('./di/container.js').Container} container - DI container with all instances
 */
export const setupRoutes = (app, container) => {
    // Health/readiness probes (high rate limit for monitoring tools, cloud balancers & Render)
    const healthRoutes = createHealthRoutes(container.get('healthController'));
    app.use('/health', healthRoutes);
    app.use('/api/v1/health', healthRoutes);

    // Core financial data endpoints
    app.use('/api/v1/financial', createFinancialRoutes(container.get('financialController')));
    app.use('/api/v1/admin', createAdminRoutes(container.get('adminController')));
    app.use('/api/v1/status', createStatusRoutes(container.get('statusController')));

    // Resource CRUD endpoints
    app.use('/api/v1/users', createUserRoutes(container.get('userController')));
    app.use('/api/v1/watchlists', createWatchlistRoutes(container.get('watchlistController')));
    app.use('/api/v1/alerts', createAlertRoutes(container.get('alertController')));
    app.use('/api/v1/assets', createAssetRoutes(container.get('assetController')));

    // Auth & Identity
    app.use('/api/v1/auth', createAuthRoutes(container.get('authController')));

    // SaaS multi-tenant, billing & API platform
    app.use('/api/v1/organizations', createOrganizationRoutes(container.get('organizationController')));
    app.use('/api/v1/billing', createBillingRoutes(container.get('billingController')));
    app.use('/api/v1/apikeys', createApiKeyRoutes(container.get('apiKeyController')));

    // AI routes — mounted unconditionally (returns 503 if disabled)
    const aiController = container.get('aiController');
    app.use('/api/v1/ai', createAIRoutes(aiController));
    if (aiController) {
        logger.info('✅ AI routes mounted at /api/v1/ai');
    } else {
        logger.info('ℹ️  AI routes mounted at /api/v1/ai (disabled mode)');
    }

    // ─── Terminal Middleware ──────────────────────────────────────────
    // These MUST be last — they handle unmatched routes and errors
    app.use(notFoundHandler); // 404 for unmatched routes
    app.use(errorHandler);    // Centralized error handler (catches all next(error) calls)
};