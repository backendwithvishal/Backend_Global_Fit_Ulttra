// Global error handler - catches all errors from controllers/middleware
// Returns structured JSON errors with appropriate HTTP status codes

import { AppError } from '../utils/errors.js';
import { logger } from '../config/logger.js';
import { config } from '../config/environment.js';

// Main error handler - must have 4 params for Express to recognize it
export const errorHandler = (err, req, res, _next) => {
    const requestId = req.requestId || 'unknown';

    // Log error with context
    logger.error('Request error', {
        requestId,
        path: req.path,
        method: req.method,
        error: err.message,
        stack: config.server.isDev ? err.stack : undefined,
        code: err.code,
    });

    // Handle custom AppError (operational errors with known status codes)
    if (err instanceof AppError) {
        return res.status(err.httpStatus).json({
            error: {
                code: err.code,
                message: config.server.isProd ? err.message : err.details || err.message,
            },
            requestId,
        });
    }

    // Handle Zod validation errors
    if (err.name === 'ZodError') {
        return res.status(400).json({
            error: {
                code: 'E1008',
                message: 'Validation error',
                details: config.server.isDev ? err.errors : undefined,
            },
            requestId,
        });
    }

    // Handle Mongoose validation errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: {
                code: 'E1008',
                message: 'Validation error',
                details: config.server.isDev ? err.message : undefined,
            },
            requestId,
        });
    }

    // Handle Multer upload errors
    if (err.name === 'MulterError') {
        const statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(statusCode).json({
            error: {
                code: 'E1017',
                message: err.message,
            },
            requestId,
        });
    }

    if (err.code === 'INVALID_FILE_TYPE' || err.code === 'INVALID_MIME_TYPE') {
        return res.status(400).json({
            error: {
                code: 'E1017',
                message: err.message,
            },
            requestId,
        });
    }

    // Unknown errors - hide details in production for security
    return res.status(500).json({
        error: {
            code: 'E1009',
            message: config.server.isProd ? 'Internal server error' : err.message,
        },
        requestId,
    });
};

// 404 handler for routes that don't exist
export const notFoundHandler = (req, res) => {
    res.status(404).json({
        error: {
            code: 'E1010',
            message: `Route not found: ${req.method} ${req.path}`,
        },
        requestId: req.requestId,
    });
};

export default errorHandler;
