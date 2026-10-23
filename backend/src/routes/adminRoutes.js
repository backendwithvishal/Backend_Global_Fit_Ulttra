/**
 * Global_Fit_Ulttra - Admin Routes
 * 
 * Express router for administrative operations.
 * These endpoints provide system management capabilities and should
 * be protected by authentication/authorization in production.
 * 
 * Route Map:
 * ──────────────────────────────────────────────────────────────────
 * | Method | Path         | Handler    | Description               |
 * |--------|--------------|------------|---------------------------|
 * | POST   | /cache/clear | clearCache | Flush Redis cache         |
 * | GET    | /metrics     | getMetrics | System performance metrics|
 * | GET    | /logs        | getLogs    | Recent application logs   |
 * ──────────────────────────────────────────────────────────────────
 * 
 * Rate Limiting: adminRateLimiter (20 req / 15 min per IP).
 * The low limit prevents accidental cache-flushing loops and excessive
 * log retrieval, which can be resource-intensive.
 * 
 * Security Notes:
 * - These endpoints should be protected with admin-only authentication
 *   when implementing auth. Currently accessible to anyone with API access.
 * - Cache clear is a POST to prevent CSRF via GET link injection.
 * 
 * @module routes/adminRoutes
 */

import { Router } from 'express';
import { adminRateLimiter } from '../middleware/index.js';
import { requireAuth, checkRole } from '../middleware/authMiddleware.js';

/**
 * Create and configure the admin routes router.
 * 
 * @param {import('../controllers/AdminController.js').AdminController} controller - Injected admin controller
 * @returns {import('express').Router} Configured Express router
 */
export const createAdminRoutes = (controller) => {
    const router = Router();

    // Apply admin rate limiter and auth verification to all admin routes
    router.use(adminRateLimiter);
    router.use(requireAuth);
    router.use(checkRole(['Admin']));

    // POST /admin/cache/clear — Flush all Redis cache entries
    // Useful for forcing fresh data fetches from external APIs
    router.post('/cache/clear', (req, res, next) => controller.clearCache(req, res, next));

    // GET /admin/metrics — System performance metrics (CPU, memory, request counts)
    router.get('/metrics', (req, res, next) => controller.getMetrics(req, res, next));

    // GET /admin/logs — Recent application log entries
    router.get('/logs', (req, res, next) => controller.getLogs(req, res, next));

    return router;
};

export default createAdminRoutes;
