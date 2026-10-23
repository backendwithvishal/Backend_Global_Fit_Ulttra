/**
 * Global_Fit_Ulttra - Middleware Index
 * 
 * Central re-export hub for all Express middleware modules.
 * Importing from this index keeps route and server files clean — they can
 * pull any middleware with a single import path.
 * 
 * @module middleware/index
 */

// ─── Error Handling ──────────────────────────────────────────────────────────
export { errorHandler, notFoundHandler } from './errorHandler.js';

// ─── Request Tracing ─────────────────────────────────────────────────────────
export { requestIdMiddleware } from './requestId.js';

// ─── Rate Limiting (all tiers) ───────────────────────────────────────────────
export {
    globalRateLimiter,
    authRateLimiter,
    authenticatedUserRateLimiter,
    adminRateLimiter,
    healthRateLimiter,
    aiRateLimiter,
} from './rateLimiter.js';

// ─── Security ────────────────────────────────────────────────────────────────
export { securityHeaders, corsMiddleware } from './securityMiddleware.js';

// ─── Logging ─────────────────────────────────────────────────────────────────
export { requestLogger } from './requestLogger.js';

// ─── Input Validation ────────────────────────────────────────────────────────
export { validateRequest } from './validateRequest.js';

// ─── Authentication ───────────────────────────────────────────────────────────
export { requireAuth, optionalAuth, checkRole } from './authMiddleware.js';
