/**
 * Global_Fit_Ulttra - Request ID Middleware
 * 
 * Injects a unique UUID v4 request identifier into every incoming HTTP request
 * for distributed tracing and log correlation.
 * 
 * How It Works:
 * 1. Checks for an existing `X-Request-Id` header (set by upstream proxies,
 *    load balancers, or API gateways like Nginx or Render).
 * 2. If found, reuses it to maintain trace continuity across services.
 * 3. If not found, generates a new UUID v4 identifier.
 * 4. Attaches the ID to `req.requestId` for use by downstream middleware
 *    and controllers (logging, error responses, etc.).
 * 5. Sets the `X-Request-Id` response header so the client can correlate
 *    their request with server-side logs.
 * 
 * Usage in Other Middleware:
 * - `requestLogger.js` logs `req.requestId` on every request
 * - `errorHandler.js` includes `requestId` in all error responses
 * - `rateLimiter.js` logs `req.requestId` when limits are exceeded
 * 
 * @module middleware/requestId
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Middleware that ensures every request has a unique identifier for tracing.
 * 
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next function
 * @returns {void}
 */
export const requestIdMiddleware = (req, res, next) => {
    // Prefer existing X-Request-Id header from upstream reverse proxy (e.g., Render, Nginx)
    // to maintain a single trace ID across the full request lifecycle.
    // Falls back to a new UUID v4 if no upstream ID exists.
    const requestId = req.headers['x-request-id'] || uuidv4();

    // Attach to req for use by all downstream middleware and controllers
    req.requestId = requestId;

    // Echo back in response headers so the client can reference it in support requests
    res.setHeader('X-Request-Id', requestId);

    next();
};

export default requestIdMiddleware;
