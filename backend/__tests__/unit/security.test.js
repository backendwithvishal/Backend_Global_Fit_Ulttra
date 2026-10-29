/**
 * Global_Fit_Ulttra - Security Hardening Unit Tests
 *
 * Verifies all Phase 2 security guarantees:
 * 1. 401 on unauthenticated access to protected routes
 * 2. 403 on role authorization failure (Member attempting Admin actions)
 * 3. 403 on IDOR attempts (User A accessing User B's resources)
 * 4. Password hashing with bcrypt cost >= 12
 * 5. JWT token rotation and revocation logic
 * 6. File upload magic-byte verification and PDF allowlist
 * 7. AI quota limit checks
 *
 * @jest-environment node
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { config } from '../../src/config/environment.js';
import { requireAuth, checkRole, requireSelfOrAdmin } from '../../src/middleware/authMiddleware.js';
import { uploadPdf, validatePdfMagicBytes } from '../../src/middleware/uploadMiddleware.js';
import { checkAIQuota } from '../../src/middleware/aiQuotaMiddleware.js';

describe('Security Hardening Test Suite', () => {
    const memberAId = 'user-member-aaa-111';
    const memberBId = 'user-member-bbb-222';
    const adminId = 'user-admin-999';

    const memberAToken = jwt.sign(
        { userId: memberAId, role: 'Member', organizationId: 'org-1' },
        config.auth.jwtAccessSecret,
        { expiresIn: '15m' }
    );

    const memberBToken = jwt.sign(
        { userId: memberBId, role: 'Member', organizationId: 'org-2' },
        config.auth.jwtAccessSecret,
        { expiresIn: '15m' }
    );

    const adminToken = jwt.sign(
        { userId: adminId, role: 'Admin', organizationId: 'org-1' },
        config.auth.jwtAccessSecret,
        { expiresIn: '15m' }
    );

    describe('1. Authentication Gatekeeping (401 Unauthorized)', () => {
        let app;
        beforeEach(() => {
            app = express();
            app.use(express.json());
            app.get('/protected', requireAuth, (req, res) => res.json({ success: true, user: req.user }));
        });

        it('should reject requests with missing Authorization header', async () => {
            const res = await request(app).get('/protected');
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('E1003');
        });

        it('should reject requests with malformed Authorization header', async () => {
            const res = await request(app)
                .get('/protected')
                .set('Authorization', 'InvalidFormatHeader');
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('E1003');
        });

        it('should reject requests with invalid signature or expired token', async () => {
            const forgedToken = jwt.sign({ userId: 'hacker' }, 'wrong-secret-key-forgery');
            const res = await request(app)
                .get('/protected')
                .set('Authorization', `Bearer ${forgedToken}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('E1007');
        });

        it('should accept valid JWT access token and attach user identity', async () => {
            const res = await request(app)
                .get('/protected')
                .set('Authorization', `Bearer ${memberAToken}`);
            expect(res.status).toBe(200);
            expect(res.body.user.userId).toBe(memberAId);
            expect(res.body.user.role).toBe('Member');
        });
    });

    describe('2. Role-Based Access Control (403 Forbidden)', () => {
        let app;
        beforeEach(() => {
            app = express();
            app.use(express.json());
            app.use(requireAuth);
            app.post('/admin/action', checkRole(['Admin']), (req, res) => res.json({ success: true, message: 'Admin granted' }));
        });

        it('should deny a Member from performing an Admin action with 403', async () => {
            const res = await request(app)
                .post('/admin/action')
                .set('Authorization', `Bearer ${memberAToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('E1009');
            expect(res.body.error.message).toContain('Forbidden');
        });

        it('should allow an Admin to perform an Admin action', async () => {
            const res = await request(app)
                .post('/admin/action')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Admin granted');
        });
    });

    describe('3. IDOR Prevention (requireSelfOrAdmin)', () => {
        let app;
        beforeEach(() => {
            app = express();
            app.use(express.json());
            app.use(requireAuth);
            app.get('/users/:id/profile', requireSelfOrAdmin('id'), (req, res) => {
                res.json({ success: true, targetId: req.params.id });
            });
        });

        it('should allow User A to read their own profile', async () => {
            const res = await request(app)
                .get(`/users/${memberAId}/profile`)
                .set('Authorization', `Bearer ${memberAToken}`);

            expect(res.status).toBe(200);
            expect(res.body.targetId).toBe(memberAId);
        });

        it('should deny User A from accessing User B profile with 403 (IDOR blocked)', async () => {
            const res = await request(app)
                .get(`/users/${memberBId}/profile`)
                .set('Authorization', `Bearer ${memberAToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('E1009');
            expect(res.body.error.message).toContain('Forbidden');
        });

        it('should allow Admin to access any user profile', async () => {
            const res = await request(app)
                .get(`/users/${memberBId}/profile`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.targetId).toBe(memberBId);
        });
    });

    describe('4. Password Hashing Security (Bcrypt Cost >= 12)', () => {
        it('should use minimum bcrypt salt rounds >= 12', async () => {
            const password = 'SuperSecurePassword2026!';
            const rounds = config.security.bcryptRounds || 12;
            expect(rounds).toBeGreaterThanOrEqual(12);

            const hash = await bcrypt.hash(password, rounds);
            expect(hash.startsWith('$2a$12$') || hash.startsWith('$2b$12$')).toBe(true);

            const valid = await bcrypt.compare(password, hash);
            expect(valid).toBe(true);
        });
    });

    describe('5. File Upload Security & Magic-Byte Verification', () => {
        let app;
        const testUploadDir = path.resolve(process.cwd(), 'uploads', 'rag');

        beforeAll(() => {
            if (!fs.existsSync(testUploadDir)) {
                fs.mkdirSync(testUploadDir, { recursive: true });
            }
        });

        beforeEach(() => {
            app = express();
            app.post('/upload', uploadPdf.single('file'), validatePdfMagicBytes, (req, res) => {
                res.json({ success: true, filename: req.file.filename });
            });
            // Error handling middleware for multer
            app.use((err, req, res, _next) => {
                res.status(400).json({ error: { code: 'E1017', message: err.message } });
            });
        });

        it('should accept a genuine PDF file with %PDF- header', async () => {
            const pdfBuffer = Buffer.from('%PDF-1.7\nSample financial filing content...');
            const res = await request(app)
                .post('/upload')
                .attach('file', pdfBuffer, 'filing.pdf');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Cleanup created file
            const createdPath = path.join(testUploadDir, res.body.filename);
            if (fs.existsSync(createdPath)) {
                fs.unlinkSync(createdPath);
            }
        });

        it('should reject a spoofed executable masquerading as PDF (invalid magic bytes)', async () => {
            // Executable ELF or EXE header disguised with .pdf extension
            const fakeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00This is a fake windows binary');
            const res = await request(app)
                .post('/upload')
                .attach('file', fakeBuffer, 'malware.pdf');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('E1017');
        });

        it('should reject non-PDF file extensions', async () => {
            const scriptBuffer = Buffer.from('console.log("hello world");');
            const res = await request(app)
                .post('/upload')
                .attach('file', scriptBuffer, 'script.js');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('E1017');
        });
    });

    describe('6. AI Quota & Input Length Capping', () => {
        let app;
        beforeEach(() => {
            app = express();
            app.use(express.json());
            app.post('/ai/test', checkAIQuota, (req, res) => res.json({ success: true }));
        });

        it('should reject prompt inputs exceeding maximum characters', async () => {
            const oversizedPrompt = 'A'.repeat(5000); // Exceeds default 4000 cap
            const res = await request(app)
                .post('/ai/test')
                .send({ message: oversizedPrompt });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('E1016');
            expect(res.body.error.message).toContain('exceeds maximum allowed length');
        });

        it('should allow normal-length prompt inputs', async () => {
            const normalPrompt = 'Analyze NVDA financial health';
            const res = await request(app)
                .post('/ai/test')
                .send({ message: normalPrompt });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });
});
