# Security Policy - Global_Fit_Ulttra

Global_Fit_Ulttra takes application security seriously. This document outlines our security policies, supported versions, vulnerability reporting process, and baseline controls.

---

## 1. Supported Versions

Security updates and patches are applied to the active branch and releases:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

---

## 2. Reporting a Vulnerability

If you discover a security vulnerability or suspect credential exposure, **DO NOT file a public GitHub issue.**

Please report security vulnerabilities responsibly via GitHub Private Security Advisories:
1. Navigate to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Provide:
   - Description of the vulnerability and attack vector.
   - Exact steps to reproduce or Proof of Concept (PoC).
   - Potential impact and affected endpoints.

### Response SLA
- **Initial Response:** Within 48 hours.
- **Triage & Assessment:** Within 5 business days.
- **Remediation & Patch:** Within 14 days for critical vulnerabilities.

---

## 3. Core Security Architecture & Defenses

### A. Authentication & Session Management
- **JWT Architecture:** Dual-token model with short-lived HMAC-SHA256 access tokens (15-minute expiry) and rotating refresh tokens (7-day expiry).
- **Refresh Token Rotation & Reuse Detection:** Presenting an invalidated or previously rotated refresh token triggers immediate invalidation of all active user sessions.
- **Password Hashing:** Passwords hashed with `bcrypt` (work factor / cost $\ge 12$).
- **Account Lockout:** Brute-force protection locks accounts for 15 minutes after 5 consecutive failed login attempts.

### B. Authorization & Access Control (RBAC & IDOR)
- **Role-Based Access Control:** Roles (`Member`, `Admin`) strictly enforced at middleware level.
- **IDOR Protection:** `requireSelfOrAdmin` middleware prevents unauthorized cross-tenant object manipulation on `/users/:id`, `/watchlists`, and `/alerts`.
- **Identity Derivation:** User ID and Organization ID are derived exclusively from verified cryptographically signed JWT claims, never from client request bodies or query parameters.

### C. Input Validation & Injection Defenses
- **NoSQL Injection:** User requests sanitized via `express-mongo-sanitize` to strip `$` and `.` operators.
- **Schema Validation:** Strict Zod validation on request parameters, query strings, and bodies; unknown fields stripped.
- **Content Security & Headers:** Helmet CSP, HSTS (`max-age=31536000; includeSubDomains; preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
- **CORS Allowlist:** Strict origin filtering from `CORS_ORIGIN` environment variable; wildcard `*` disallowed in production.

### D. AI / RAG Safety & File Uploads
- **Upload Restrictions:** Multi-part file uploads restricted to PDF only (`.pdf` extension, MIME type `application/pdf`, and magic-byte header `%PDF-`).
- **Filename Sanitization:** Uploaded files stored outside public web roots with randomized UUID filenames.
- **AI Quota & Prompt Injection Defense:** Per-user daily token spend quota stored in Redis, 4,000-character input caps, and strict delimiter isolation (`<<<UNTRUSTED_DATA_START>>> ... <<<UNTRUSTED_DATA_END>>>`) preventing indirect prompt injection from filings or financial news.

### E. Rate Limiting
- Distributed, Redis-backed rate limiting with graceful in-memory fallbacks:
  - Auth routes: 5 requests / 15 minutes
  - AI endpoints: 10 requests / 1 minute
  - Global API: 100 requests / 15 minutes
  - Authenticated user tier: 1,000 requests / 15 minutes
