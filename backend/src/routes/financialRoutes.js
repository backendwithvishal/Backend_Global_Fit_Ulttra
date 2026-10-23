/**
 * Global_Fit_Ulttra - Financial Routes
 * 
 * Express router for financial data retrieval endpoints.
 * These are the primary data endpoints that aggregate information from
 * multiple external APIs (Alpha Vantage, CoinGecko, FRED, etc.).
 * 
 * Route Map:
 * ──────────────────────────────────────────────────────────────────
 * | Method | Path    | Handler   | Description                     |
 * |--------|---------|-----------|---------------------------------|
 * | GET    | /live   | getLive   | Fresh data from external APIs   |
 * | GET    | /cached | getCached | Cached data from Redis (faster) |
 * ──────────────────────────────────────────────────────────────────
 * 
 * Rate Limiting: globalRateLimiter (100 req / 15 min per IP).
 * The global limiter is already applied at the `/api` prefix level in server.js,
 * so these routes get double protection.
 * 
 * Performance Notes:
 * - `/live` triggers real-time API calls (slower, 2-5s). Use sparingly.
 * - `/cached` returns Redis-cached data (fast, <50ms). Preferred for dashboards.
 * 
 * @module routes/financialRoutes
 */

import { Router } from 'express';

/**
 * Create and configure the financial routes router.
 * 
 * @param {import('../controllers/FinancialController.js').FinancialController} controller - Injected financial controller
 * @returns {import('express').Router} Configured Express router
 */
export const createFinancialRoutes = (controller) => {
    const router = Router();

    // GET /financial/live — Fetch fresh data from all external API sources
    // This bypasses cache and makes real API calls; subject to external rate limits
    router.get('/live', (req, res, next) => controller.getLive(req, res, next));

    // GET /financial/cached — Return cached financial data from Redis
    // Falls back to empty/stale data if cache is cold
    router.get('/cached', (req, res, next) => controller.getCached(req, res, next));

    return router;
};

export default createFinancialRoutes;
