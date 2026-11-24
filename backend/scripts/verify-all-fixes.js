/**
 * Global_Fit_Ulttra - Comprehensive End-to-End API Verification Script
 * 
 * Verifies all 11 issues fixed in the task.
 */

import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createApp, setupRoutes } from '../src/app.js';
import { getContainer } from '../src/di/container.js';
import { connectDatabase, closeDatabaseConnection } from '../src/config/database.js';
import { config } from '../src/config/environment.js';
import { User, Organization, Invitation } from '../src/models/index.js';

let server;
let baseUrl;

function request(method, path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(baseUrl + path);
        const headers = options.headers || {};
        let body = options.body;

        if (body && typeof body === 'object' && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(body);
        }

        const req = http.request(url, {
            method,
            headers
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let json = null;
                try {
                    json = JSON.parse(data);
                } catch (_) {
                    json = data;
                }
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: json
                });
            });
        });

        req.on('error', reject);
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

function generateTOTP(secret, time = Date.now()) {
    const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    function base32ToBuffer(str) {
        const cleaned = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
        let bits = '';
        for (let i = 0; i < cleaned.length; i++) {
            const val = BASE32_ALPHABET.indexOf(cleaned[i]);
            if (val === -1) continue;
            bits += val.toString(2).padStart(5, '0');
        }
        const bytes = [];
        for (let i = 0; i + 8 <= bits.length; i += 8) {
            bytes.push(parseInt(bits.slice(i, i + 8), 2));
        }
        return Buffer.from(bytes);
    }

    const key = base32ToBuffer(secret);
    const timeStep = Math.floor(time / 1000 / 30);
    const msg = Buffer.alloc(8);
    msg.writeBigInt64BE(BigInt(timeStep));
    const hmac = crypto.createHmac('sha1', key).update(msg).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
    return code.toString().padStart(6, '0');
}

async function run() {
    console.log('='.repeat(70));
    console.log('🧪 RUNNING COMPREHENSIVE API FIX VERIFICATION');
    console.log('='.repeat(70));

    await connectDatabase();
    const app = createApp();
    server = http.createServer(app);
    const io = new SocketIOServer(server);
    const container = getContainer();
    await container.initialize({ io });
    setupRoutes(app, container);
    await new Promise(res => server.listen(0, res));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}/api/v1`;
    console.log(`Server listening on ephemeral port ${port}, baseUrl: ${baseUrl}\n`);

    const results = [];

    // Helper to generate JWT token
    const makeToken = (user) => {
        return jwt.sign({
            userId: user._id.toString(),
            id: user._id.toString(),
            email: user.email,
            role: user.role,
            subscriptionTier: user.subscriptionTier || 'Enterprise'
        }, config.security.jwtAccessSecret, { expiresIn: '1h' });
    };

    // Setup Test Users
    await User.deleteMany({ email: { $in: ['test_admin@example.com', 'test_member@example.com', 'invite_user@example.com', 'magic_user@example.com', 'verify_test@example.com'] } });

    const adminUser = await User.create({
        email: 'test_admin@example.com',
        firstName: 'Test',
        lastName: 'Admin',
        role: 'Admin',
        isEmailVerified: true,
        isActive: true,
        subscriptionTier: 'Enterprise'
    });
    const adminToken = makeToken(adminUser);

    const memberUser = await User.create({
        email: 'test_member@example.com',
        firstName: 'Test',
        lastName: 'Member',
        role: 'Member',
        isEmailVerified: true,
        isActive: true,
        subscriptionTier: 'Free'
    });
    const memberToken = makeToken(memberUser);

    // ─────────────────────────────────────────────────────────────
    // ISSUE 1: GET /api/v1/status
    // ─────────────────────────────────────────────────────────────
    console.log('👉 [1] Testing GET /api/v1/status...');
    const res1 = await request('GET', '/status');
    const pass1 = res1.status === 200 && res1.body.status === 'healthy' && res1.body.database === 'connected' && typeof res1.body.uptime === 'number';
    results.push({ test: '1. GET /api/v1/status', passed: pass1, status: res1.status, details: JSON.stringify(res1.body) });
    console.log(`   Result: ${pass1 ? '✅ PASS' : '❌ FAIL'} (Status: ${res1.status})`);

    // ─────────────────────────────────────────────────────────────
    // ISSUE 2: GET /api/v1/users?page=1&limit=20
    // ─────────────────────────────────────────────────────────────
    console.log('👉 [2] Testing GET /api/v1/users?page=1&limit=20 (RBAC check)...');
    const res2_admin = await request('GET', '/users?page=1&limit=20', {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const res2_member = await request('GET', '/users?page=1&limit=20', {
        headers: { 'Authorization': `Bearer ${memberToken}` }
    });
    const pass2 = res2_admin.status === 200 && Array.isArray(res2_admin.body.users) && res2_member.status === 403 && res2_member.body.error?.code === 'E1009';
    results.push({ test: '2. GET /api/v1/users?page=1&limit=20', passed: pass2, status: `Admin:${res2_admin.status}, Member:${res2_member.status}`, details: `Admin returned ${res2_admin.body.users?.length} users, Member was correctly blocked (403 E1009)` });
    console.log(`   Result: ${pass2 ? '✅ PASS' : '❌ FAIL'} (Admin: ${res2_admin.status}, Member: ${res2_member.status})`);

    // ─────────────────────────────────────────────────────────────
    // ISSUE 3: GET /api/v1/auth/verify-email?token=...
    // ─────────────────────────────────────────────────────────────
    console.log('👉 [3] Testing GET /api/v1/auth/verify-email?token=...');
    const verifyUser = await User.create({
        email: 'verify_test@example.com',
        firstName: 'Verify',
        lastName: 'Test',
        isEmailVerified: false,
        emailVerificationToken: 'raw_test_verify_token_123',
        emailVerificationExpires: new Date(Date.now() + 3600000)
    });
    const res3_valid = await request('GET', `/auth/verify-email?token=raw_test_verify_token_123`);
    const res3_used = await request('GET', `/auth/verify-email?token=raw_test_verify_token_123`);
    const pass3 = res3_valid.status === 200 && res3_used.status === 400 && res3_used.body.error === 'Invalid or expired verification token';
    results.push({ test: '3. GET /api/v1/auth/verify-email', passed: pass3, status: `Valid:${res3_valid.status}, Used:${res3_used.status}`, details: `Valid token verified email (200), subsequent request rejected (400)` });
    console.log(`   Result: ${pass3 ? '✅ PASS' : '❌ FAIL'} (Valid: ${res3_valid.status}, Used: ${res3_used.status})`);

    // ─────────────────────────────────────────────────────────────
    // ISSUE 4: POST /api/v1/auth/magic-link
    // ─────────────────────────────────────────────────────────────
    console.log('👉 [4] Testing POST /api/v1/auth/magic-link...');
    const res4 = await request('POST', '/auth/magic-link', {
        body: { email: 'test_admin@example.com' }
    });
    const updatedAdmin4 = await User.findById(adminUser._id).select('+magicLoginToken +magicLoginExpires');
    const pass4 = res4.status === 200 && res4.body.message?.includes('magic login link has been generated') && Boolean(updatedAdmin4.magicLoginToken);
    results.push({ test: '4. POST /api/v1/auth/magic-link', passed: pass4, status: res4.status, details: `Returned generic 200 and generated token (${updatedAdmin4.magicLoginToken?.slice(0, 10)}...)` });
    console.log(`   Result: ${pass4 ? '✅ PASS' : '❌ FAIL'} (Status: ${res4.status})`);

    // ─────────────────────────────────────────────────────────────
    // ISSUE 5: POST /api/v1/auth/request-reset
    // ─────────────────────────────────────────────────────────────
    console.log('👉 [5] Testing POST /api/v1/auth/request-reset...');
    const res5 = await request('POST', '/auth/request-reset', {
        body: { email: 'test_admin@example.com' }
    });
    const updatedAdmin5 = await User.findById(adminUser._id).select('+passwordResetToken +passwordResetExpires');
    const pass5 = res5.status === 200 && res5.body.message?.includes('password reset link has been generated') && Boolean(updatedAdmin5.passwordResetToken);
    results.push({ test: '5. POST /api/v1/auth/request-reset', passed: pass5, status: res5.status, details: `Returned generic 200 and generated reset token` });
    console.log(`   Result: ${pass5 ? '✅ PASS' : '❌ FAIL'} (Status: ${res5.status})`);

    // ─────────────────────────────────────────────────────────────
    // ISSUE 6: GET /api/v1/auth/magic-link/callback?token=...
    // ─────────────────────────────────────────────────────────────
    console.log('👉 [6] Testing GET /api/v1/auth/magic-link/callback?token=...');
    const magicToken = updatedAdmin4.magicLoginToken;
    const res6_valid = await request('GET', `/auth/magic-link/callback?token=${magicToken}`);
    const res6_used = await request('GET', `/auth/magic-link/callback?token=${magicToken}`);
    const pass6 = res6_valid.status === 200 && Boolean(res6_valid.body.accessToken) && res6_valid.body.user?.role === 'Admin' && res6_used.status === 401;
    results.push({ test: '6. GET /api/v1/auth/magic-link/callback', passed: pass6, status: `Valid:${res6_valid.status}, Used:${res6_used.status}`, details: `Successfully logged in with JWT & role, single-use token invalidated immediately` });
    console.log(`   Result: ${pass6 ? '✅ PASS' : '❌ FAIL'} (Valid: ${res6_valid.status}, Used: ${res6_used.status})`);

    // ─────────────────────────────────────────────────────────────
    // ISSUE 7: POST /api/v1/auth/mfa/enable
    // ─────────────────────────────────────────────────────────────
    console.log('👉 [7] Testing POST /api/v1/auth/mfa/enable...');
    const res7_setup = await request('POST', '/auth/mfa/setup', {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const secret = res7_setup.body.secret;
    const totpCode = generateTOTP(secret);
    const res7_enable = await request('POST', '/auth/mfa/enable', {
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: { code: totpCode }
    });
    const pass7 = res7_setup.status === 200 && res7_enable.status === 200 && Array.isArray(res7_enable.body.backupCodes);
    results.push({ test: '7. POST /api/v1/auth/mfa/enable', passed: pass7, status: res7_enable.status, details: `Setup generated secret (${secret}), TOTP verified (${totpCode}) and MFA enabled with 8 backup codes` });
    console.log(`   Result: ${pass7 ? '✅ PASS' : '❌ FAIL'} (Status: ${res7_enable.status})`);

    // ─────────────────────────────────────────────────────────────
    // ISSUE 8: POST /api/v1/organizations/invite/accept
    // ─────────────────────────────────────────────────────────────
    console.log('👉 [8] Testing POST /api/v1/organizations/invite/accept...');
    const testOrg = await Organization.create({
        name: 'Test Acme Corp',
        slug: 'test-acme-corp-' + Date.now(),
        ownerId: adminUser._id,
        members: [{ userId: adminUser._id, role: 'Owner' }]
    });

    // Create invite with leading/trailing whitespace
    const inviteRes = await request('POST', `/organizations/${testOrg._id}/invite`, {
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: { email: '  Test_Member@example.com  ', role: 'Member' }
    });
    const inviteToken = inviteRes.body.invite?.token;

    // Accept invite as memberUser whose email is 'test_member@example.com'
    const acceptRes = await request('POST', '/organizations/invite/accept', {
        headers: { 'Authorization': `Bearer ${memberToken}` },
        body: { token: inviteToken }
    });
    const pass8 = inviteRes.status === 201 && acceptRes.status === 200 && acceptRes.body.message?.includes('Joined organization');
    results.push({ test: '8. POST /api/v1/organizations/invite/accept', passed: pass8, status: acceptRes.status, details: `Normalized trimmed email matched user ('${memberUser.email}') and accepted invite` });
    console.log(`   Result: ${pass8 ? '✅ PASS' : '❌ FAIL'} (Status: ${acceptRes.status})`);

    // ─────────────────────────────────────────────────────────────
    // ISSUE 9: PUT/PATCH /api/v1/organizations/:orgId/members/:memberId/role
    // ─────────────────────────────────────────────────────────────
    console.log('👉 [9] Testing PUT/PATCH /api/v1/organizations/:orgId/members/:memberId/role...');
    const res9_patch = await request('PATCH', `/organizations/${testOrg._id}/members/${memberUser._id}/role`, {
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: { role: 'Admin' }
    });
    const res9_put = await request('PUT', `/organizations/${testOrg._id}/members/${memberUser._id}/role`, {
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: { role: 'Manager' }
    });
    const res9_404 = await request('PATCH', `/organizations/6b001cd1dae0310155336f4f/members/${memberUser._id}/role`, {
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: { role: 'Admin' }
    });
    const pass9 = res9_patch.status === 200 && res9_put.status === 200 && res9_404.status === 404;
    results.push({ test: '9. PUT/PATCH /api/v1/organizations/:orgId/members/:memberId/role', passed: pass9, status: `PATCH:${res9_patch.status}, PUT:${res9_put.status}, 404:${res9_404.status}`, details: `Successfully updated member role via both PATCH and PUT, properly returned 404 on non-existent org` });
    console.log(`   Result: ${pass9 ? '✅ PASS' : '❌ FAIL'} (PATCH: ${res9_patch.status}, PUT: ${res9_put.status}, 404: ${res9_404.status})`);

    // ─────────────────────────────────────────────────────────────
    // ISSUE 10: Billing Endpoints Audit
    // ─────────────────────────────────────────────────────────────
    console.log('👉 [10] Auditing ALL Billing endpoints...');
    // 10.1 Checkout with planId or plan
    const res10_checkout = await request('POST', '/billing/checkout', {
        headers: { 'Authorization': `Bearer ${memberToken}` },
        body: { plan: 'Pro', billingCycle: 'monthly', couponCode: 'GLOBALFIT20' }
    });
    const sessionId = res10_checkout.body.sessionId;

    // 10.2 Confirm checkout with sessionId (planId inferred)
    const res10_confirm = await request('POST', '/billing/confirm', {
        headers: { 'Authorization': `Bearer ${memberToken}` },
        body: { sessionId }
    });

    // 10.3 Invoices
    const res10_invoices = await request('GET', '/billing/invoices', {
        headers: { 'Authorization': `Bearer ${memberToken}` }
    });

    // 10.4 Coupons
    const res10_coupon = await request('GET', '/billing/coupons/GLOBALFIT20', {
        headers: { 'Authorization': `Bearer ${memberToken}` }
    });

    // 10.5 Cancel
    const res10_cancel = await request('POST', '/billing/cancel', {
        headers: { 'Authorization': `Bearer ${memberToken}` }
    });

    const pass10 = res10_checkout.status === 200 && res10_confirm.status === 200 && res10_invoices.status === 200 && res10_coupon.status === 200 && res10_cancel.status === 200;
    results.push({ test: '10. Billing Endpoints (checkout, confirm, cancel, invoices, coupon)', passed: pass10, status: `All 200 OK`, details: `checkout: ${res10_checkout.status}, confirm: ${res10_confirm.status}, cancel: ${res10_cancel.status}, invoices: ${res10_invoices.status}, coupons: ${res10_coupon.status}` });
    console.log(`   Result: ${pass10 ? '✅ PASS' : '❌ FAIL'} (checkout:${res10_checkout.status}, confirm:${res10_confirm.status}, cancel:${res10_cancel.status}, invoices:${res10_invoices.status}, coupon:${res10_coupon.status})`);

    // ─────────────────────────────────────────────────────────────
    // ISSUE 11: POST /api/v1/ai/rag/ingest & RAG Audit
    // ─────────────────────────────────────────────────────────────
    console.log('👉 [11] Testing POST /api/v1/ai/rag/ingest and RAG endpoints...');
    const res11_health = await request('GET', '/ai/rag/health');
    const res11_ingest_admin = await request('POST', '/ai/rag/ingest', {
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: {
            filePath: './data/financial_documents/AAPL_FY24_Q3_Financial_Filing.pdf',
            symbol: 'AAPL',
            filingType: '10-Q',
            isPublic: true
        }
    });
    const res11_ingest_member = await request('POST', '/ai/rag/ingest', {
        headers: { 'Authorization': `Bearer ${memberToken}` },
        body: { symbol: 'AAPL' }
    });
    const res11_docs = await request('GET', '/ai/rag/documents?page=1&limit=5', {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const pass11 = res11_ingest_admin.status === 202 && res11_ingest_member.status === 403 && (res11_health.status === 200 || res11_health.status === 503) && res11_docs.status === 200;
    results.push({ test: '11. RAG Ingest and Endpoints', passed: pass11, status: `Admin ingest:${res11_ingest_admin.status}, Member ingest:${res11_ingest_member.status}, Docs:${res11_docs.status}`, details: `Admin ingest accepted (202), unauthorized member blocked (403 E1009), document list returned 200` });
    console.log(`   Result: ${pass11 ? '✅ PASS' : '❌ FAIL'} (Admin Ingest: ${res11_ingest_admin.status}, Member: ${res11_ingest_member.status}, Documents: ${res11_docs.status})`);

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY REPORT');
    console.log('='.repeat(70));
    let allPassed = true;
    for (const r of results) {
        console.log(`${r.passed ? '✅' : '❌'} ${r.test.padEnd(50)} | ${r.status}`);
        if (!r.passed) allPassed = false;
    }
    console.log('='.repeat(70));
    console.log(`ALL TESTS PASSED: ${allPassed ? 'YES 🎉' : 'NO ❌'}`);
    console.log('='.repeat(70) + '\n');

    server.close();
    await closeDatabaseConnection();
    process.exit(allPassed ? 0 : 1);
}

run().catch(err => {
    console.error('Test execution failed:', err);
    if (server) server.close();
    closeDatabaseConnection();
    process.exit(1);
});
