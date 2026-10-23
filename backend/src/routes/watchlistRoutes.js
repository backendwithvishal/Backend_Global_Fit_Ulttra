/**
 * Global_Fit_Ulttra - Watchlist Routes
 * 
 * Express router for watchlist management and asset assignment endpoints.
 * 
 * Route Map:
 * ───────────────────────────────────────────────────────────────────────────────
 * | Method | Path                    | Handler          | Description           |
 * |--------|-------------------------|------------------|-----------------------|
 * | GET    | /                       | listWatchlists   | List all watchlists   |
 * | GET    | /:id                    | getWatchlist      | Get watchlist by ID   |
 * | POST   | /                       | createWatchlist   | Create watchlist      |
 * | PUT    | /:id                    | updateWatchlist   | Update watchlist      |
 * | DELETE | /:id                    | deleteWatchlist   | Delete watchlist      |
 * | POST   | /:id/assets             | addAsset          | Add asset to list     |
 * | DELETE | /:id/assets/:symbol     | removeAsset       | Remove asset from list|
 * ───────────────────────────────────────────────────────────────────────────────
 * 
 * Rate Limiting: authenticatedUserRateLimiter (1000 req / 15 min per user/IP)
 * Validation: Zod schemas from validators/watchlistSchemas.js
 * 
 * @module routes/watchlistRoutes
 */

import { Router } from 'express';
import { authenticatedUserRateLimiter } from '../middleware/index.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
    createWatchlistSchema,
    updateWatchlistSchema,
    getWatchlistSchema,
    deleteWatchlistSchema,
    listWatchlistsSchema,
    addAssetSchema,
    removeAssetSchema,
} from '../validators/watchlistSchemas.js';

/**
 * Create and configure the watchlist routes router.
 * 
 * @param {import('../controllers/WatchlistController.js').WatchlistController} controller - Injected watchlist controller
 * @returns {import('express').Router} Configured Express router
 */
export const createWatchlistRoutes = (controller) => {
    const router = Router();

    // Apply authenticated-user rate limiter to all watchlist routes (1000 req / 15 min)
    router.use(authenticatedUserRateLimiter);

    // GET /watchlists — List all watchlists with optional filters (userId, isPublic, etc.)
    router.get('/', validateRequest(listWatchlistsSchema), (req, res, next) => controller.listWatchlists(req, res, next));

    // GET /watchlists/:id — Get a single watchlist by its MongoDB ObjectID
    router.get('/:id', validateRequest(getWatchlistSchema), (req, res, next) => controller.getWatchlist(req, res, next));

    // POST /watchlists — Create a new watchlist
    router.post('/', validateRequest(createWatchlistSchema), (req, res, next) => controller.createWatchlist(req, res, next));

    // PUT /watchlists/:id — Full update of a watchlist (name, description, tags, etc.)
    router.put('/:id', validateRequest(updateWatchlistSchema), (req, res, next) => controller.updateWatchlist(req, res, next));

    // DELETE /watchlists/:id — Delete a watchlist and its asset associations
    router.delete('/:id', validateRequest(deleteWatchlistSchema), (req, res, next) => controller.deleteWatchlist(req, res, next));

    // ─── Asset Management within a Watchlist ────────────────────────────────

    // POST /watchlists/:id/assets — Add a financial asset to the watchlist
    router.post('/:id/assets', validateRequest(addAssetSchema), (req, res, next) => controller.addAsset(req, res, next));

    // DELETE /watchlists/:id/assets/:symbol — Remove an asset from the watchlist
    router.delete('/:id/assets/:symbol', validateRequest(removeAssetSchema), (req, res, next) => controller.removeAsset(req, res, next));

    return router;
};

export default createWatchlistRoutes;
