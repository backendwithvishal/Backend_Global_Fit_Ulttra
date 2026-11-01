// Winston logger configuration
// Structured JSON for production, pretty printing for development

import winston from 'winston';
import { config } from './environment.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Ensure logs directory exists
const logDir = dirname(config.logging.filePath);
if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
}

// Sensitive field masking to prevent accidental credential leakage in logs
const SENSITIVE_KEYS = new Set([
    'password', 'passwordhash', 'token', 'refreshtoken', 'accesstoken',
    'authorization', 'cookie', 'secret', 'jwtsecret', 'apikey', 'key',
    'groqapikey', 'redispassword', 'mongouri', 'bearer'
]);

const maskObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    for (const key of Object.keys(obj)) {
        if (SENSITIVE_KEYS.has(key.toLowerCase()) || /password|secret|token|api_?key/i.test(key)) {
            obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            maskObject(obj[key]);
        }
    }
    return obj;
};

export const maskSensitiveData = winston.format((info) => {
    maskObject(info);
    if (typeof info.message === 'string') {
        info.message = info.message.replace(/(token|magic_token|password|secret|api_?key)=([a-zA-Z0-9_\-.~%]+)/gi, '$1=[REDACTED]');
    }
    return info;
});

// Custom format for adding metadata
const addMetadata = winston.format((info) => {
    info.timestamp = new Date().toISOString();
    info.service = 'global-fit-ulttra';
    return info;
});

// Development format - colorized and readable
const devFormat = winston.format.combine(
    addMetadata(),
    maskSensitiveData(),
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, requestId, ...meta }) => {
        const reqId = requestId ? `[${requestId}]` : '';
        const metaStr = Object.keys(meta).length > 1
            ? `\n${JSON.stringify(meta, null, 2)}`
            : '';
        return `${timestamp} ${level} ${reqId} ${message}${metaStr}`;
    })
);

// Production format - structured JSON
const prodFormat = winston.format.combine(
    addMetadata(),
    maskSensitiveData(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Transports configuration
const transports = [
    new winston.transports.Console({
        format: config.server.isProd ? prodFormat : devFormat,
    }),
];

// Add file transport in production
if (config.server.isProd) {
    transports.push(
        new winston.transports.File({
            filename: config.logging.filePath,
            format: prodFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: config.logging.filePath.replace('.log', '.error.log'),
            level: 'error',
            format: prodFormat,
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
        })
    );
}

export const logger = winston.createLogger({
    level: config.logging.level,
    transports,
    exitOnError: false,
});

let isLoggerClosed = false;

export const createRequestLogger = (requestId) => {
    return logger.child({ requestId });
};

// Safe logging wrapper - prevents writing after logger is closed
export const safeLog = (level, message, meta = {}) => {
    if (!isLoggerClosed) {
        logger[level](message, meta);
    } else {
        console[level === 'error' ? 'error' : 'log'](`[${level.toUpperCase()}]`, message, meta);
    }
};

export const flushLogger = () => {
    return new Promise((resolve) => {
        if (isLoggerClosed) {
            resolve();
            return;
        }
        
        isLoggerClosed = true;
        
        logger.on('finish', () => {
            resolve();
        });
        
        setTimeout(() => {
            resolve();
        }, 5000);
        
        logger.end();
    });
};

export const isLoggerActive = () => !isLoggerClosed;

export default logger;
