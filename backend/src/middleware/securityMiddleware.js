// Security middleware - Helmet headers + CORS configuration
// Dev: allows configured local origins, Prod: strict whitelist only

import helmet from 'helmet';
import cors from 'cors';
import { config } from '../config/environment.js';

// Helmet security headers - CSP allows WebSocket for Socket.io
export const securityHeaders = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'ws:', 'wss:'],
            fontSrc: ["'self'", 'https:', 'data:'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
        },
    },
    hsts: config.server.isProd ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
    } : false,
    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
});

// CORS - dynamic origin checking based on environment
export const corsMiddleware = cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (curl, server-to-server, native apps)
        if (!origin) {
            return callback(null, true);
        }

        // Check whitelist
        if (config.security.corsOrigins && config.security.corsOrigins.includes(origin)) {
            return callback(null, true);
        }

        // Dev mode - allow localhost origins if not in production
        if (config.server.isDev && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
            return callback(null, true);
        }

        // Reject - not whitelisted
        callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400,
});

export default { securityHeaders, corsMiddleware };
