// Security middleware - Helmet headers + CORS configuration
// Dev: allows all origins, Prod: whitelist only

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
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
});

// CORS - dynamic origin checking based on environment
export const corsMiddleware = cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (curl, Postman, mobile apps)
        if (!origin) {
            return callback(null, true);
        }

        // Check whitelist
        if (config.security.corsOrigins.includes(origin)) {
            return callback(null, true);
        }

        // Dev mode - allow all origins
        if (config.server.isDev) {
            return callback(null, true);
        }

        // Reject - not whitelisted
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400,
});

export default { securityHeaders, corsMiddleware };
