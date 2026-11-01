/**
 * Global_Fit_Ulttra - Upload Security Middleware
 *
 * Enforces:
 * 1. Strict PDF-only whitelist (extension & MIME type).
 * 2. Magic-byte verification (%PDF-) on file headers to prevent executable disguise.
 * 3. Random server-side filenames (UUID) to prevent path traversal & filename collision.
 * 4. File size limits (10MB max).
 * 5. Isolated storage directory outside public web root.
 *
 * @module middleware/uploadMiddleware
 */

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { logger } from '../config/logger.js';
import { config } from '../config/environment.js';

// Dedicated upload directory outside web root
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'rag');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Disk storage with randomized safe filenames
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueId = crypto.randomUUID();
        cb(null, `${uniqueId}.pdf`);
    },
});

// File filter allowlisting PDF only
const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.pdf') {
        const err = new Error('Only PDF documents are allowed for ingestion');
        err.code = 'INVALID_FILE_TYPE';
        return cb(err, false);
    }
    if (file.mimetype !== 'application/pdf' && file.mimetype !== 'application/x-pdf') {
        const err = new Error('Invalid MIME type. Expected application/pdf');
        err.code = 'INVALID_MIME_TYPE';
        return cb(err, false);
    }
    cb(null, true);
};

// 10MB default file size limit
const maxSizeBytes = config.rag?.maxFileSizeBytes || 10 * 1024 * 1024;

export const uploadPdf = multer({
    storage,
    limits: {
        fileSize: maxSizeBytes,
        files: 1,
    },
    fileFilter,
});

/**
 * Validates that uploaded file contains genuine PDF magic bytes (%PDF-).
 * Deletes invalid or spoofed files immediately.
 */
export const validatePdfMagicBytes = async (req, res, next) => {
    if (!req.file) {
        return next();
    }

    const filePath = req.file.path;
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(5);
        fs.readSync(fd, buffer, 0, 5, 0);
        fs.closeSync(fd);

        // Check for %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
        const header = buffer.toString('ascii');
        if (!header.startsWith('%PDF')) {
            try {
                fs.unlinkSync(filePath);
            } catch (_) {
                // Ignore unlink error
            }
            logger.warn('Uploaded file failed magic byte verification', {
                filename: req.file.originalname,
                header,
            });
            return res.status(400).json({
                error: {
                    code: 'E1017',
                    message: 'Uploaded file is not a valid PDF document (invalid magic bytes).',
                },
                requestId: req.requestId,
            });
        }

        next();
    } catch (err) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (_) {
            // Ignore error if file was already removed
        }
        logger.error('Failed to verify uploaded file magic bytes', { error: err.message });
        return res.status(400).json({
            error: {
                code: 'E1018',
                message: 'Failed to inspect uploaded file.',
            },
            requestId: req.requestId,
        });
    }
};
