/**
 * Global_Fit_Ulttra - Status Routes
 * 
 * Express router for system status and monitoring endpoints.
 * Provides visibility into the health of external API integrations
 * and the current rate limiting configuration.
 * 
 * Route Map:
 * ──────────────────────────────────────────────────────────────────────────
 * | Method | Path              | Handler            | Description          |
 * |--------|-------------------|--------------------|----------------------|
 * | GET    | /circuit-breakers | getCircuitBreakers | External API status  |
 * | GET    | /rate-limits      | getRateLimits      | Rate limit config    |
 * ──────────────────────────────────────────────────────────────────────────
 * 
 * Rate Limiting: globalRateLimiter (100 req / 15 min) via /api prefix.
 * These are read-only diagnostic endpoints suitable for monitoring dashboards.
 * 
 * @module routes/statusRoutes
 */

import { Router } from 'express';

/**
 * Create and configure the status routes router.
 * 
 * @param {import('../controllers/StatusController.js').StatusController} controller - Injected status controller
 * @returns {import('express').Router} Configured Express router
 */
export const createStatusRoutes = (controller) => {
    const router = Router();

    // GET /status/circuit-breakers — Shows open/closed/half-open state of each external API circuit
    router.get('/circuit-breakers', (req, res) => controller.getCircuitBreakers(req, res));

    // GET /status/rate-limits — Shows current rate limiting configuration for all tiers
    router.get('/rate-limits', (req, res) => controller.getRateLimits(req, res));

    return router;
};

export default createStatusRoutes;