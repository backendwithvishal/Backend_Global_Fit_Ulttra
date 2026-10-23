/**
 * Global_Fit_Ulttra - Health Routes
 * 
 * Express router for health check and readiness probe endpoints.
 * Used by load balancers (Render, Kubernetes), monitoring services
 * (UptimeRobot, Datadog), and deployment pipelines to verify the
 * application is running and ready to serve traffic.
 * 
 * Route Map:
 * ──────────────────────────────────────────────────────────────────
 * | Method | Path       | Handler   | Description                  |
 * |--------|------------|-----------|------------------------------|
 * | GET    | /health    | health    | Basic liveness check         |
 * | GET    | /readiness | readiness | Detailed dependency status   |
 * ──────────────────────────────────────────────────────────────────
 * 
 * Rate Limiting: healthRateLimiter (1000 req / 1 min) — very lenient to
 * accommodate frequent automated polling by infrastructure services.
 * 
 * Note: The `/health` endpoint is also configured as the `healthCheckPath`
 * in render.yaml for Render.com deployment health monitoring.
 * 
 * @module routes/healthRoutes
 */

import { Router } from 'express';
import { healthRateLimiter } from '../middleware/index.js';

/**
 * Create and configure the health routes router.
 * 
 * @param {import('../controllers/HealthController.js').HealthController} controller - Injected health controller
 * @returns {import('express').Router} Configured Express router
 */
export const createHealthRoutes = (controller) => {
    const router = Router();

    // GET /api/v1/health (and /api/v1/health/health) — Basic liveness check
    router.get('/', healthRateLimiter, (req, res) => controller.health(req, res));
    router.get('/health', healthRateLimiter, (req, res) => controller.health(req, res));

    // GET /health/readiness — Detailed readiness: checks MongoDB, Redis, and external API connectivity
    // Returns service-by-service status; useful for deployment verification
    router.get('/readiness', healthRateLimiter, (req, res) => controller.readiness(req, res));

    // GET /health/ping — Lightweight keep-alive endpoint for cron services & uptime monitors
    router.get('/ping', healthRateLimiter, (req, res) => controller.ping(req, res));

    return router;
};

export default createHealthRoutes;
