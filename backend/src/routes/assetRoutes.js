/**
 * Global_Fit_Ulttra - Asset Routes
 * 
 * Express router for financial asset management endpoints.
 * 
 * Route Map:
 * ──────────────────────────────────────────────────────────────────────────────
 * | Method | Path            | Handler          | Description                  |
 * |--------|-----------------|------------------|------------------------------|
 * | GET    | /               | searchAssets     | Search/list assets (paged)   |
 * | GET    | /:symbol        | getAsset         | Get asset by symbol          |
 * | GET    | /:symbol/live   | getLiveAssetData | Get live data from APIs      |
 * | POST   | /               | createAsset      | Create new asset record      |
 * | PUT    | /:symbol        | updateAsset      | Update asset by symbol       |
 * | DELETE | /:symbol        | deleteAsset      | Delete asset by symbol       |
 * ──────────────────────────────────────────────────────────────────────────────
 * 
 * Rate Limiting: authenticatedUserRateLimiter (1000 req / 15 min per user/IP)
 * Validation: Zod schemas from validators/assetSchemas.js
 * 
 * Note: Assets are keyed by `symbol` (e.g. "AAPL", "BTC") rather than MongoDB
 * ObjectID. Symbols are automatically uppercased and trimmed by the validator.
 * 
 * @module routes/assetRoutes
 */

import { Router } from 'express';
import { authenticatedUserRateLimiter } from '../middleware/index.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
    createAssetSchema,
    updateAssetSchema,
    getAssetSchema,
    deleteAssetSchema,
    searchAssetsSchema,
    getLiveAssetSchema,
} from '../validators/assetSchemas.js';

/**
 * Create and configure the asset routes router.
 * 
 * @param {import('../controllers/AssetController.js').AssetController} controller - Injected asset controller
 * @returns {import('express').Router} Configured Express router
 */
export const createAssetRoutes = (controller) => {
    const router = Router();

    // Apply authenticated-user rate limiter to all asset routes (1000 req / 15 min)
    router.use(authenticatedUserRateLimiter);

    // GET /assets — Search or list all assets with optional type/search filters
    router.get('/', validateRequest(searchAssetsSchema), (req, res, next) => controller.searchAssets(req, res, next));

    // GET /assets/:symbol — Get a single asset by its ticker symbol
    router.get('/:symbol', validateRequest(getAssetSchema), (req, res, next) => controller.getAsset(req, res, next));

    // GET /assets/:symbol/live — Fetch live market data from external APIs
    // This hits external APIs and is more expensive — the global rate limiter
    // also applies, providing double protection on expensive operations
    router.get('/:symbol/live', validateRequest(getLiveAssetSchema), (req, res, next) => controller.getLiveAssetData(req, res, next));

    // POST /assets — Create a new financial asset record in the database
    router.post('/', validateRequest(createAssetSchema), (req, res, next) => controller.createAsset(req, res, next));

    // PUT /assets/:symbol — Update an existing asset by its ticker symbol
    router.put('/:symbol', validateRequest(updateAssetSchema), (req, res, next) => controller.updateAsset(req, res, next));

    // DELETE /assets/:symbol — Delete an asset by its ticker symbol
    router.delete('/:symbol', validateRequest(deleteAssetSchema), (req, res, next) => controller.deleteAsset(req, res, next));

    return router;
};

export default createAssetRoutes;
