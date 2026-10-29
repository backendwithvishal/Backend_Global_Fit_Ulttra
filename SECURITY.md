# Security Policy - Global_Fit_Ulttra

Global_Fit_Ulttra implements defense-in-depth security engineering for multi-tenant financial orchestration and agentic RAG workflows. This document details our supported versions, vulnerability reporting process, verified security controls, known residual risks, and operational maintenance schedules.

---

## 1. Supported Versions

Security updates and critical patches are actively maintained for:

| Version | Status | Patch Policy |
| :--- | :--- | :--- |
| **1.0.x** | :white_check_mark: Supported | Security patches applied within 48h for criticals |
| **< 1.0** | :x: End of Life | Not supported |

---

## 2. Reporting a Vulnerability

If you discover a security vulnerability or suspect credential leakage, **DO NOT create a public GitHub issue.**

Please report security disclosures via GitHub Private Security Advisories:
1. Navigate to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Include:
   - Vulnerability category (e.g. Auth bypass, IDOR, Injection, SSRF).
   - Step-by-step reproduction guide or Proof of Concept (PoC).
   - Affected routes or components.

### Response SLA
- **Initial Response & Triage:** Within 24–48 hours.
- **Assessment & Fix Plan:** Within 3 business days.
- **Remediation & Patch Release:** Within 7 business days for high/critical findings.

---

## 3. Verified Security Controls & Hardening (Penetration Test Remediation)

The repository underwent rigorous penetration testing and independent review across all HTTP endpoints, WebSocket events, and infrastructure definitions. All 14 identified findings have been resolved and covered by regression unit tests (`backend/__tests__/unit/security.test.js`):

### A. Authentication & Session Security
- **Dual-Token JWT Architecture:** Short-lived access tokens (15 minutes) and rotating refresh tokens (7 days).
- **Algorithm Pinning:** Strictly pinned to `{ algorithms: ['HS256'] }` on all `jwt.verify` calls. Tokens signed with `none` or asymmetric keys are rejected immediately (`E1007`).
- **Token Type Isolation:** Access token middleware explicitly rejects tokens containing `tokenType: 'refresh'` to prevent refresh tokens from being reused as Bearer credentials.
- **Scoped Refresh Token Cookie:** Refresh token cookies are strictly scoped to `Path=/api/v1/auth/refresh; HttpOnly; Secure; SameSite=Strict`.
- **Password Hashing:** Passwords hashed using `bcrypt` with cost factor $\ge 12$.
- **Two-Factor Authentication (2FA/TOTP):** Fully compliant with **RFC 3548 Base32** alphabet (`A-Z`, `2-7`) and HMAC-SHA1 counter verification.

### B. Authorization, Tenancy & IDOR Defenses
- **Registration Mass Assignment Defense (VULN-01):** Registration schema strips privileged attributes (`role`, `subscriptionTier`, `isEmailVerified`, `passwordHash`). `UserService.createUser` hardcodes new registrations to `Member` role and `Free` tier.
- **Billing Plan Tampering Defense (VULN-02):** Payment confirmations require a valid, non-expired checkout session bound to the user's ID and plan. Sessions are atomically deleted upon redemption to prevent replay attacks.
- **RAG Multi-Tenancy Isolation (VULN-04):** Document retrieval, listing, deletion, and vector store queries enforce strict `organizationId` isolation. Queries without organization context default to public documents only (`isPublic: true`).
- **API Key Tenancy & Ownership (VULN-05):** Key generation and listing require Organization Owner/Admin membership. Key deactivation requires ownership of the key or organization admin rights.
- **Organization IDOR Protection (VULN-08):** `OrganizationController.getOrg` denies access with `403 Forbidden` to non-members unless the caller holds system `admin` privileges.

### C. Injection & ReDoS Defenses
- **NoSQL Injection:** User requests sanitized via `express-mongo-sanitize` to strip `$` and `.` operators.
- **Search ReDoS Prevention (VULN-09):** All user input in MongoDB regex queries is sanitized with `replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`. Input lengths capped to 100 characters in Joi schemas.
- **Prompt Injection Defense (VULN-10):** All external documents and user queries synthesized by the Agentic RAG orchestrator are stripped of control characters and wrapped in strict data boundary markers:
  ```
  <<<UNTRUSTED_DOCUMENT_CONTENT_START>>>
  ...
  <<<UNTRUSTED_DOCUMENT_CONTENT_END>>>
  ```
  All LLM assertions must map to verified document chunk IDs.

### D. Rate Limiting & Quota Abuse Defenses
- **Atomic AI Quotas (VULN-06):** Daily AI token limits are tracked atomically in Redis using `INCRBY` with reservation and rollback upon quota breach.
- **Socket.IO Stream Throttling (VULN-07):** WebSocket AI handlers (`ai:analyze`, `ai:sentiment`, `ai:recommend`, `ai:rag:query`, `ai:chat`) are throttled by a 10 req/min sliding-window rate limiter with real-time quota deduction.
- **Log Data Scrubbing (VULN-03):** Sensitive tokens (magic link tokens, verification tokens, reset tokens, API keys) are masked in Winston logs and URL strings using `[MASKED]` / `[REDACTED]`.

### E. Container & Infrastructure Security
- **Rootless Container Execution:** Production Docker containers run under an unprivileged `nodejs` user (`UID 1001`).
- **Signal Forwarding:** Uses `/sbin/tini` as PID 1 to ensure graceful shutdown and zombie process reaping.
- **Zero Insecure Defaults (VULN-13):** `docker-compose.yml` uses `${VAR:?Error required}` syntax, preventing containers from booting with default passwords.
- **Render Blueprint:** All secrets in `render.yaml` are marked `sync: false`.

---

## 4. Verification Evidence

The entire security implementation is continuously validated:

- **Unit & Security Regression Suite:** 173 / 173 tests passing (8 / 8 test suites clean) via `npm test`.
- **Static Code Analysis:** 0 ESLint errors via `npm run lint`.
- **Gitleaks Secret Audit:** 41 commits scanned across full history; 0 leaks found (`gitleaks detect --source="." --log-opts="--all"`).

---

## 5. Residual Risk Assessment

While the application implements strict defense-in-depth, security teams should account for these operational and architectural realities:

1. **MongoDB Atlas IP Allowlist on Shared Cloud PaaS:**
   - Render's standard web services share a dynamic outbound IP pool. In MongoDB Atlas, access typically requires `0.0.0.0/0` unless a Render Dedicated IP or VPC Peering is provisioned.
   - *Mitigation:* Enforce strong 32-character random database passwords, least-privilege `readWrite` database user roles, and TLS 1.3 encryption.
2. **Probabilistic Nature of LLM Prompt Injection:**
   - While prompt sanitization and XML/boundary tags mitigate indirect prompt injection, no LLM software layer can mathematically guarantee 100% resistance to novel jailbreaks.
   - *Mitigation:* Grounded RAG synthesis enforces factual citation validation against retrieved chunk IDs and refuses out-of-context claims.
3. **In-Memory Rate Limiting Fallback:**
   - If Redis becomes unavailable, rate limiters gracefully fall back to local in-memory storage. While this guarantees uptime, multi-instance horizontal scaling would track rate limits per-instance rather than globally during a Redis outage.
   - *Mitigation:* Managed Redis with auto-failover and uptime monitoring.

---

## 6. Recommended Maintenance & Operations Routine

To maintain security hygiene, engineering teams must adhere to the following maintenance cadence:

### A. Weekly Routine
- **Dependency Audit:** Run `npm audit --omit=dev` in `backend/` to detect newly disclosed CVEs.
- **Gitleaks Pre-Commit Check:** Run `gitleaks detect` locally before merging branches to prevent secret leaks.

### B. Monthly Routine
- **Automated Dependabot / Renovate Review:** Review and merge automated patch-level security pull requests.
- **Render & Cloud Log Review:** Audit application logs for recurring 401s, 429s, or circuit breaker trips.
- **AI Quota & Cost Review:** Audit Groq Cloud spend and token usage against budget thresholds.

### C. Quarterly (90-Day) Secret Rotation Schedule
- **Provider API Keys:** Rotate Groq, Qdrant, Alpha Vantage, Finnhub, and NewsAPI keys.
- **Database & Cache Passwords:** Rotate MongoDB Atlas user password and Redis Cloud password.
- **Update Render Environment:** Apply rotated secrets in the Render Dashboard and trigger a zero-downtime rolling deployment.

### D. Bi-Annual (180-Day) Routine
- **JWT Secret Rotation:** Generate fresh 64-byte HMAC secrets for `JWT_SECRET`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`. *(Note: Forces user re-authentication upon rotation).*
