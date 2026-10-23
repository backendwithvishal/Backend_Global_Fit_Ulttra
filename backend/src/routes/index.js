/**
 * Global_Fit_Ulttra - Routes Index
 * 
 * Central re-export hub for all route factory functions.
 * Each route module exports a `create*Routes(controller)` factory that
 * accepts a DI-injected controller and returns a configured Express Router.
 * 
 * Route Hierarchy:
 * ────────────────────────────────────────────────────────────────────────
 * | Prefix              | Module        | Rate Limiter                   |
 * |---------------------|---------------|--------------------------------|
 * | /api/v1/health      | healthRoutes  | healthRateLimiter (1000/min)   |
 * | /api/v1/financial   | financialRoutes| globalRateLimiter (100/15min) |
 * | /api/v1/admin       | adminRoutes   | adminRateLimiter (20/15min)    |
 * | /api/v1/status      | statusRoutes  | globalRateLimiter (100/15min)  |
 * | /api/v1/users       | userRoutes    | authenticatedUser (1000/15min) |
 * | /api/v1/watchlists  | watchlistRoutes| authenticatedUser (1000/15min)|
 * | /api/v1/alerts      | alertRoutes   | authenticatedUser (1000/15min) |
 * | /api/v1/assets      | assetRoutes   | authenticatedUser (1000/15min) |
 * | /api/v1/ai          | aiRoutes      | aiRateLimiter (10/min)         |
 * ────────────────────────────────────────────────────────────────────────
 * 
 * @module routes/index
 */

export { createHealthRoutes } from './healthRoutes.js';
export { createFinancialRoutes } from './financialRoutes.js';
export { createAdminRoutes } from './adminRoutes.js';
export { createStatusRoutes } from './statusRoutes.js';
export { createUserRoutes } from './userRoutes.js';
export { createWatchlistRoutes } from './watchlistRoutes.js';
export { createAlertRoutes } from './alertRoutes.js';
export { createAssetRoutes } from './assetRoutes.js';
export { createAuthRoutes } from './authRoutes.js';
export { createOrganizationRoutes } from './organizationRoutes.js';
export { createBillingRoutes } from './billingRoutes.js';
export { createApiKeyRoutes } from './apiKeyRoutes.js';
export { createRAGRoutes } from './ragRoutes.js';