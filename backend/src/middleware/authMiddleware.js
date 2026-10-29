/**
 * JWT Authentication Middleware
 *
 * Verifies the Bearer token on protected routes and attaches
 * the decoded payload to req.user.
 *
 * Usage:
 *   router.get('/protected', requireAuth, handler)
 *
 * @module middleware/authMiddleware
 */

import jwt from 'jsonwebtoken';
import { config } from '../config/environment.js';

/**
 * Require a valid JWT access token.
 * Returns 401 if missing/invalid, 403 if expired.
 */
export const requireAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    // Fallback to cookie
    if (!token && req.headers.cookie) {
        const cookies = Object.fromEntries(
            req.headers.cookie.split(';').map(c => c.trim().split('='))
        );
        token = cookies['token'] || cookies['accessToken'] || cookies['gfu_token'];
    }

    if (!token) {
        return res.status(401).json({
            error: { code: 'E1003', message: 'Authentication required. Please provide a Bearer token or session cookie.' },
            requestId: req.requestId,
        });
    }

    try {
        const secret = config.security.jwtAccessSecret || config.security.jwtSecret;
        const payload = jwt.verify(token, secret);
        req.user = {
            ...payload,
            // Normalize ID: ensure both userId and id are accessible
            userId: payload.userId || payload.id,
            id: payload.userId || payload.id,
            role: payload.role || 'Member',
        };
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(403).json({
                error: { code: 'E1006', message: 'Token expired. Please refresh your session or sign in again.' },
                requestId: req.requestId,
            });
        }
        return res.status(401).json({
            error: { code: 'E1007', message: 'Invalid token.' },
            requestId: req.requestId,
        });
    }
};

/**
 * Optionally attach user info from JWT if present — does NOT block unauthenticated requests.
 */
export const optionalAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (!token && req.headers.cookie) {
        const cookies = Object.fromEntries(
            req.headers.cookie.split(';').map(c => c.trim().split('='))
        );
        token = cookies['token'] || cookies['accessToken'] || cookies['gfu_token'];
    }

    if (token) {
        try {
            const secret = config.security.jwtAccessSecret || config.security.jwtSecret;
            const payload = jwt.verify(token, secret);
            req.user = {
                ...payload,
                userId: payload.userId || payload.id,
                id: payload.userId || payload.id,
                role: payload.role || 'Member',
            };
        } catch {
            // Invalid token — treat as unauthenticated
        }
    }

    next();
};

/**
 * Route middleware to enforce specific user roles (case-insensitive).
 */
export const checkRole = (allowedRoles) => {
    const normalizedAllowed = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles])
        .map(r => String(r).toLowerCase());

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: { code: 'E1003', message: 'Authentication required.' },
                requestId: req.requestId,
            });
        }

        const userRole = (req.user.role || 'Member').toLowerCase();
        if (!normalizedAllowed.includes(userRole)) {
            return res.status(403).json({
                error: { code: 'E1009', message: 'Forbidden. Insufficient permissions.' },
                requestId: req.requestId,
            });
        }

        next();
    };
};

/**
 * Shorthand for checkRole (e.g., requireRole('admin') or requireRole(['Admin', 'SuperAdmin']))
 */
export const requireRole = (role) => checkRole(role);

/**
 * IDOR guard: verifies that the authenticated user owns the resource or is an Admin.
 * Matches `req.user.userId` against `req.params[paramKey]`.
 */
export const requireSelfOrAdmin = (paramKey = 'id') => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: { code: 'E1003', message: 'Authentication required.' },
                requestId: req.requestId,
            });
        }

        const targetUserId = req.params[paramKey];
        const isSelf = String(req.user.userId) === String(targetUserId);
        const isAdmin = (req.user.role || '').toLowerCase() === 'admin';

        if (!isSelf && !isAdmin) {
            return res.status(403).json({
                error: { code: 'E1009', message: 'Forbidden. You do not have permission to access or modify this user.' },
                requestId: req.requestId,
            });
        }

        next();
    };
};

export default requireAuth;
