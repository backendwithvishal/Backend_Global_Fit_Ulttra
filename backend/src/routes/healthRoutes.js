/**
 * Global_Fit_Ulttra - Health Routes
 * 
 * Express router for health check, liveness, and readiness probe endpoints.
 * Used by load balancers (Render, Kubernetes), monitoring services
 * (UptimeRobot, Datadog), and deployment pipelines to verify the
 * application is running and ready to serve traffic.
 * 
 * Route Map:
 * ──────────────────────────────────────────────────────────────────
 * | Method | Path       | Handler   | Description                  |
 * |--------|------------|-----------|------------------------------|
 * | GET    | /          | health    | Full diagnostic report       |
 * | GET    | /health    | health    | Alias for full report        |
 * | GET    | /live      | liveness  | Lightweight liveness probe   |
 * | GET    | /ready     | readiness | Readiness dependency check   |
 * | GET    | /readiness | readiness | Alias for readiness check    |
 * | GET    | /ping      | ping      | Ping keep-alive check        |
 * ──────────────────────────────────────────────────────────────────
 * 
 * Rate Limiting: healthRateLimiter (1000 req / 1 min).
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

    // Canonical Full Diagnostic Health Check: GET /health and GET /api/v1/health
    router.get('/', healthRateLimiter, (req, res) => controller.health(req, res));
    router.get('/health', healthRateLimiter, (req, res) => controller.health(req, res));

    // Liveness Probe: GET /health/live and GET /api/v1/health/live
    router.get('/live', healthRateLimiter, (req, res) => controller.liveness(req, res));

    // Readiness Probes: GET /health/ready, /health/readiness
    router.get('/ready', healthRateLimiter, (req, res) => controller.readiness(req, res));
    router.get('/readiness', healthRateLimiter, (req, res) => controller.readiness(req, res));

    // Ping Keep-Alive: GET /health/ping and GET /api/v1/health/ping
    router.get('/ping', healthRateLimiter, (req, res) => controller.ping(req, res));

    return router;
};

export default createHealthRoutes;
