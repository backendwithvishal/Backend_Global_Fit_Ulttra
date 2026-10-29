# Security Policy — Global_Fit_Ulttra

Global_Fit_Ulttra implements practical application security controls for real-time financial market data orchestration and Agentic RAG workflows. This document outlines supported versions, vulnerability reporting procedures, verified security controls, test evidence, residual risks, and maintenance routines.

---

## 1. Supported Versions

Security updates and bug fixes are maintained for the current release stream matching [`package.json`](file:///d:/Projects/Global_Fit_Ulttra/package.json) (`version: 1.0.0`):

| Version | Supported | Patch & Triage Policy |
| :--- | :--- | :--- |
| **1.0.x** | Yes | Initial triage within 72h; critical fix target within 14 business days (best effort) |
| **< 1.0** | No | End of Life (unsupported) |

---

## 2. Reporting a Vulnerability

If you discover a security vulnerability or suspect credential exposure, **do not open a public GitHub issue**.

### Preferred Channel: GitHub Private Security Advisories
1. Navigate to the **Security** tab of the [`Global_Fit_Ulttra`](https://github.com/backendwithvishal/Backend-Global_Fit_Ulttra) repository.
2. Click **Report a vulnerability** to submit a confidential report directly to the repository maintainer.
3. Include:
   - Vulnerability category (e.g. Authentication bypass, IDOR, Injection, SSRF, Rate limit circumvention).
   - Clear step-by-step reproduction instructions or a minimal Proof of Concept (PoC).
   - Affected endpoints, parameters, or source files.
   - Assessment of potential impact.

### Fallback Security Contact
If GitHub Private Vulnerability Reporting is unavailable, contact the maintainer directly:
- **Email:** `[YOUR_SECURITY_EMAIL@DOMAIN.COM]` *(Maintainer: replace with your dedicated security contact email)*
- **PGP Key:** Available upon request for encrypted communications.

### Response & Remediation SLA
As a project maintained by an individual developer / small team, the following realistic SLA targets apply:
- **Initial Acknowledgment & Triage:** Within **72 hours**.
- **Assessment & Fix Plan:** Within **7 business days**.
- **Critical Fix & Patch Release Target:** Within **14 business days** (best effort, prioritized by severity).

### Safe Harbor Statement
Any activities conducted in a manner consistent with this policy will be considered authorized conduct:
- We will not initiate legal action against researchers for good-faith, non-destructive security research.
- If third parties initiate legal action against you for activities conducted under this policy, we will make it known that your actions were authorized.
- Researchers are expected to give the maintainer reasonable time to remediate issues before any public disclosure.

### Scope & Out-of-Scope Research
**In-Scope:**
- API authentication and authorization mechanisms (`/api/v1/auth/*`, `/api/v1/admin/*`, `/api/v1/users/*`, `/api/v1/organizations/*`).
- Multi-tenant data isolation and IDOR vulnerabilities in RAG documents and financial assets.
- Prompt injection and sanitization boundaries in LLM orchestration pipelines.
- Rate limiting and quota reservation race conditions in API and WebSocket endpoints.
- Injection flaws (NoSQL injection, Command injection, ReDoS).

**Out-of-Scope:**
- Volumetric Denial of Service (DDoS/DoS) attacks targeting network infrastructure or third-party cloud hosts (Render, Atlas, Redis Cloud).
- Social engineering, phishing, or physical attacks against maintainers or hosting providers.
- Vulnerabilities in third-party services themselves (e.g. Groq Cloud, Alpha Vantage, Finnhub, Qdrant Cloud), except as they relate to improper validation or handling by this application.
- Issues related to missing DNS SPF/DKIM/DMARC records on domain names not used for transactional mail.

---

## 3. Verified Security Controls & Hardening (Internal Security Review Remediation)

An internal security review was conducted on October 29–30, 2026 covering commit [`e7e8030`](https://github.com/backendwithvishal/Backend-Global_Fit_Ulttra/commit/e7e80306df5602dfcd1535bd2c9aadf4d33579db) and preceding commits. The review combined manual code audit and automated tooling (ESLint, Gitleaks, Semgrep, Trivy). Fourteen findings (`VULN-01` through `VULN-14`) were identified and resolved, with automated test coverage verified in [`backend/__tests__/unit/security.test.js`](file:///d:/Projects/Global_Fit_Ulttra/backend/__tests__/unit/security.test.js):

### A. Authentication & Session Security
- **Dual-Token Architecture (`VULN-11`):** Short-lived access tokens (15 minutes) and rotating refresh tokens (7 days). `requireAuth` explicitly verifies that incoming Bearer tokens contain access claims and rejects tokens containing `tokenType: 'refresh'` (`E1007`).
- **Cryptographic Algorithm Pinning (`VULN-11`):** All `jwt.verify` calls explicitly pin `{ algorithms: ['HS256'] }`. Tokens signed with algorithm `none` or asymmetric keys are rejected immediately.
- **Distinct Signing Secrets & Zero-Logout Rotation:** `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are required to be distinct strings of at least 32 characters enforced at server boot. To allow zero-logout secret rotation, the verification logic optionally accepts `JWT_ACCESS_SECRET_PREVIOUS` and `JWT_REFRESH_SECRET_PREVIOUS` during grace windows, allowing existing sessions to expire naturally while signing all new tokens with updated keys.
- **Scoped Refresh Token Cookie & Revocation (`VULN-14`):** Refresh token cookies are scoped to `Path=/api/v1/auth/refresh; HttpOnly; Secure; SameSite=Strict`. The logout handler is accessible on both `/api/v1/auth/logout` and `/api/v1/auth/refresh/logout`, revoking the refresh token in the MongoDB user document (`revokedAt = new Date()`) and clearing cookies across both paths. Subsequent attempts to rotate a revoked refresh token are rejected.
- **Password Hashing:** Passwords are hashed using `bcrypt` with cost factor >= 12 (default 12 rounds in production).
  - *Bcrypt 72-Byte Truncation Limit Handling:* Bcrypt's underlying Blowfish cipher truncates password input at 72 bytes. Input validation schemas enforce `max(128)` characters. Passwords exceeding 72 bytes are evaluated up to byte 72. *(Pre-hashing passwords with SHA-256 prior to bcrypt is planned to safely accommodate passphrases of arbitrary length without truncation).*
- **Two-Factor Authentication (2FA/TOTP) (`VULN-12`):** Base32 secret generation adheres to RFC 4648 (`[A-Z2-7]`). Counter verification evaluates HMAC-SHA1 across a 30-second time step with a ±1 drift window (90-second total verification window) per RFC 6238 / RFC 4226. Single-use backup codes are removed upon redemption. *(Note: Encrypted secret storage at rest and single-use TOTP replay tracking are planned enhancements).*

### B. Authorization, Tenancy & IDOR Defenses
- **Registration Mass Assignment Defense (`VULN-01`):** `registerSchema` strips privileged properties (`role`, `subscriptionTier`, `isEmailVerified`, `passwordHash`). `UserService.createUser` hardcodes self-registered users to `Member` role and `Free` subscription tier.
- **Billing Plan Tampering Defense (`VULN-02`):** `BillingService` tracks cryptographic checkout sessions bound to user ID, target plan, and 1-hour expiration. Sessions are deleted upon redemption to prevent replay and privilege escalation.
- **RAG Multi-Tenancy Isolation (`VULN-04`):** Document retrieval, listing, deletion, and vector store queries in `RAGService` enforce strict `organizationId` boundaries. Queries without an organization context default strictly to public documents (`isPublic: true`).
- **API Key Tenancy & Ownership (`VULN-05`):** Key creation and listing require Organization Owner/Admin membership. Key deactivation requires direct key ownership or organization administrative privileges.
- **Organization IDOR Protection (`VULN-08`):** `OrganizationController.getOrg` denies access with `403 Forbidden` (`E1009`) to users who are not active members of the requested organization, unless the caller holds system `Admin` role.
- **Administrative Route Protection:** All `/api/v1/admin/*` endpoints enforce `adminRateLimiter` (20 req / 15 min), `requireAuth`, and `checkRole(['Admin'])`. Member accounts attempting admin operations receive `403 Forbidden`.

### C. Injection, ReDoS & Input Hardening Defenses
- **NoSQL Injection Defense:** Incoming request payloads pass through `express-mongo-sanitize` configured with `{ replaceWith: '_' }`, sanitizing MongoDB query operators (`$` and `.`).
- **Search ReDoS Prevention (`VULN-09`):** All user search strings passed to MongoDB regular expressions in `FinancialAssetRepository` are escaped with `replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`. Input lengths are capped to 100 characters in schemas.
- **Prompt Injection Delimiter Sanitization (`VULN-10`):** `sanitizeForPrompt` in `aiQuotaMiddleware.js` strips non-printable control characters (`[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]`) and boundary marker tags (`<<<UNTRUSTED_DATA_START/END>>>` and `<<<UNTRUSTED_DOCUMENT_CONTENT_START/END>>>`) from untrusted inputs before wrapping text in data boundary tags.
  - *Reality Note:* Prompt boundaries reduce the likelihood of indirect prompt injection and delimiters escaping into instructions, but cannot mathematically eliminate prompt injection. Grounded RAG synthesis enforces factual citation matching against retrieved chunk IDs.
- **Request Size Limits:**
  - JSON and URL-encoded body limit: `2MB` (`express.json({ limit: '2mb' })`).
  - Socket.IO buffer ceiling: `1MB` (`maxHttpBufferSize: 1e6`).
  - RAG PDF uploads: `10MB` limit, single file per request (`limits: { fileSize: 10485760, files: 1 }`).
  - AI prompt text: Hard cap of 4,000 characters in `checkAIQuota`.
  - WebSocket RAG questions: Hard cap of 1,000 characters in `handleRAGQuery`.

### D. Rate Limiting, Quotas & WebSocket Security
- **Atomic AI Quotas (`VULN-06`):** Daily per-user AI token limits (default 50,000 tokens) are tracked in Redis using atomic `INCRBY` reservations with automated rollback (`DECRBY`) upon quota breach.
- **Socket.IO Handshake Authentication & Per-Event Throttling (`VULN-07`):**
  - All WebSocket connections undergo handshake authentication in `server.js` (`io.use`), verifying JWT access tokens via `HS256`, rejecting refresh tokens, and populating `socket.user`.
  - General WebSocket events are throttled to 60 events/minute per socket in `SocketManager`.
  - AI WebSocket streaming events (`ai:chat`, `ai:analyze`, `ai:sentiment`, `ai:recommend`, `ai:rag:query`) are capped at 10 requests/minute in `AIStreamHandler` with per-request token quota deductions.
- **Sensitive Token Masking in Logs (`VULN-03`):** Winston logger's `maskSensitiveData` redacts verification tokens, reset tokens, magic link tokens, and API keys from log objects and URL query parameters (`[REDACTED]`).

### E. Container & Infrastructure Security
- **Rootless Container Execution:** Production container builds ([`Dockerfile`](file:///d:/Projects/Global_Fit_Ulttra/Dockerfile)) execute under an unprivileged `nodejs` user (`UID 1001`, `GID 1001`).
- **Signal Forwarding & Zombie Reaping:** Uses `/sbin/tini` as PID 1 entrypoint for reliable SIGTERM forwarding and child process reaping.
- **Zero Insecure Defaults (`VULN-13`):** [`docker-compose.yml`](file:///d:/Projects/Global_Fit_Ulttra/docker-compose.yml) enforces required environment variables using `"${VAR:?Error: VAR must be set}"` syntax, preventing startup with fallback passwords.
- **Network Isolation:** Docker Compose isolates databases (`mongo`, `redis`, `qdrant`, `rabbitmq`) on an internal network (`internal: true`). Only the application service exposes port 4000 bound exclusively to localhost loopback (`127.0.0.1:4000:4000`).
- **Render Configuration:** All secrets in [`render.yaml`](file:///d:/Projects/Global_Fit_Ulttra/render.yaml) are configured with `sync: false`.
- **RAG Upload Pipeline Hardening:** Uploaded files in `POST /api/v1/rag/ingest` require `Admin` role, enforce a `.pdf` extension and `application/pdf` MIME type, verify genuine `%PDF-` magic bytes header (deleting invalid files immediately), assign random UUID filenames to prevent path traversal, and store files outside public web roots (`uploads/rag`).

---

## 4. Verification Evidence

The security controls and regression test suites are verified directly against active code:

| Verification Type | Command Executed | Result | Details |
| :--- | :--- | :--- | :--- |
| **Unit & Security Regression Suite** | `npm test` | **178 / 178 passing** | 8 test suites clean (including 20 security hardening blocks in [`security.test.js`](file:///d:/Projects/Global_Fit_Ulttra/backend/__tests__/unit/security.test.js)) |
| **Static Code Analysis (ESLint)** | `npm run lint` | **0 errors** | 57 console logging warnings in dev/eval tools; 0 syntax or security errors |
| **Secret Scan (Gitleaks - Full History)** | `docker run --rm -v "${PWD}:/path" zricethezav/gitleaks:latest detect --source="/path" --verbose` | **0 leaks found** | 43 commits scanned across full git history; 3.15 MB evaluated |
| **Container Build** | `docker build -t global-fit-ulttra:test .` | **Build Success (Exit 0)** | Multi-stage builder on `node:22-alpine` with production dependency pruning |
| **Compose Syntax & Interpolation** | `docker compose --env-file .env.example config` | **Valid (Exit 0)** | All service definitions, networks, and required variable constraints validated |
| **Dependency Vulnerability Audit** | `npm audit --omit=dev` | **13 findings (upstream transitive)** | 3 moderate, 8 high, 2 critical in transitive packages (`protobufjs`, `sharp`, `tar`, `undici`, `uuid`, `zod`). Documented below in Known Gaps |

- **Verification Date:** October 30, 2026
- **Git Commit SHA:** `399cedac080fa3395ca1a3ac4597c856a11b1eb8`
- **Node Runtime:** `v22.19.0` (Local) / `node:22-alpine` (Docker)
- **CI Workflow Link:** [Security Hardening & Quality Gate Workflow](.github/workflows/security.yml)

---

## 5. Residual Risk Assessment

1. **MongoDB Atlas IP Allowlist on Shared Cloud PaaS:**
   - Render standard web services share dynamic outbound IP pools that can change over time. In MongoDB Atlas, access typically requires allowlisting `0.0.0.0/0` unless Render Dedicated Outbound IPs (available on paid Team/Pro workspaces at an extra monthly cost) are provisioned. Standard Render Web Services do not support AWS/GCP VPC Peering.
   - *Mitigations:* Strong 32-character random database passwords, least-privilege `readWrite` database user roles, and TLS connection encryption (verify minimum TLS version in MongoDB Atlas cluster network settings).
2. **Probabilistic Nature of LLM Prompt Injection:**
   - While input sanitization strips boundary tags (`<<<UNTRUSTED_DATA_START/END>>>`) and control characters, no application layer can mathematically eliminate novel semantic jailbreak attempts.
   - *Mitigations:* Agentic RAG synthesis enforces factual citation matching against retrieved chunk IDs and refuses out-of-context claims.
3. **Redis Outage Behavior & In-Memory Fallback:**
   - **Rate Limiters (`rateLimiter.js`):** If Redis becomes unreachable, `ResilientRateLimitStore` falls back to process-local `MemoryStore` with strict limits (5 req/15 min for auth, 100 req/15 min global).
   - **AI Token Quotas (`aiQuotaMiddleware.js`):** If Redis fails during token reservation, quota tracking falls back to process-local memory mapping with the daily hard cap (50,000 tokens). Unhandled quota calculation errors fail closed with `429 Too Many Requests`.
   - **WebSocket AI Limits (`AIStreamHandler.js`):** Falls back to local memory quota tracking; if unrecoverable, fails closed (`return false`).
   - **Refresh Tokens & Sessions (`UserService.js`):** Stored directly in MongoDB (`User.refreshTokens`), so session validation, rotation, and revocation operate normally during Redis downtime.
   - *Mitigation:* Multi-instance horizontal deployments should monitor Redis availability; during an outage, rate limits and quotas are tracked per-instance rather than cluster-wide.

---

## 6. Recommended Maintenance & Operations Routine

### A. Weekly Routine
- **Dependency Audit:** Run `npm audit --omit=dev` in root and `backend/` to monitor newly disclosed CVEs.
- **Automated Secret Scan:** Run `gitleaks detect` locally (or via pre-commit hook in `.githooks/pre-commit`) before merging branches.

### B. Monthly Routine
- **Automated Dependabot Review:** Review and merge automated dependency updates created by [`.github/dependabot.yml`](file:///d:/Projects/Global_Fit_Ulttra/.github/dependabot.yml) (covers root npm, backend npm, docker images, and GitHub Actions).
- **Runtime Anomaly Review:** Inspect Render and server logs for abnormal bursts of `401 Unauthorized`, `403 Forbidden`, or `429 Too Many Requests`.
- **AI Spend Review:** Audit Groq Cloud token consumption and spend against cost limits.

### C. Quarterly (90-Day) Secret Rotation Schedule
Rotate all production credentials listed in [`.env.example`](file:///d:/Projects/Global_Fit_Ulttra/.env.example) and [`render.yaml`](file:///d:/Projects/Global_Fit_Ulttra/render.yaml):
- **External API Keys:** Rotate Groq Cloud (`GROQ_API_KEY`), Qdrant Cloud (`QDRANT_API_KEY`), Alpha Vantage (`ALPHA_VANTAGE_API_KEY`), Finnhub (`FINNHUB_API_KEY`), NewsAPI (`NEWS_API_KEY`), FRED (`FRED_API_KEY`), and CoinGecko keys.
- **AI Gateway & Infrastructure:** Rotate LiteLLM Master Key (`LITELLM_MASTER_KEY`) and RabbitMQ password (`RABBITMQ_DEFAULT_PASS`).
- **Database & Cache:** Rotate MongoDB Atlas user password and Redis Cloud password.
- **JWT Signing Keys:**
  - *Zero-Logout Rotation:* Set `JWT_ACCESS_SECRET_PREVIOUS` to the current access secret, deploy a newly generated 48-byte base64 secret as `JWT_ACCESS_SECRET`, and repeat for `JWT_REFRESH_SECRET` and `JWT_REFRESH_SECRET_PREVIOUS`. After the 15-minute access token lifespan and refresh window elapse, clear the previous secret variables.
  - *Standard Rotation (without previous secret):* Generates fresh secrets directly; active users will be prompted to re-authenticate upon access token expiration.

### D. Emergency Secret Rotation Procedure (Suspected Leak)
In the event of suspected credential exposure:
1. **Immediate Invalidation:** Rotate exposed API keys or database passwords immediately in provider consoles (Groq, MongoDB Atlas, Redis Cloud, etc.).
2. **Revoke Active Sessions:** Update `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` without previous fallback keys, forcing immediate re-authentication across all active user sessions.
3. **Audit Access Logs:** Review cloud provider and application logs for unauthorized access during the exposure window.
4. **Git History Remediation:** If secrets were committed to Git, rotate credentials immediately, then purge commits from repository history using [`git-filter-repo`](https://github.com/newren/git-filter-repo) or BFG Repo-Cleaner before force-pushing.

---

## 7. Known Gaps & Planned Enhancements

| Component | Status | Description & Planned Control |
| :--- | :--- | :--- |
| **Transitive Dependency CVEs** | Known Gap | Transitive dependencies in `@xenova/transformers` (`protobufjs`, `onnx-proto`, `sharp`) and `@qdrant/js-client-rest` (`undici`) contain upstream advisories. Upstream PRs and patches are tracked via Dependabot. Direct user-facing file inputs do not process arbitrary Protobuf or image files. |
| **Bcrypt Pre-Hashing** | Planned | Passwords currently truncate at 72 bytes due to Blowfish key limitations. A planned enhancement will pre-hash passwords with SHA-256 before bcrypt hashing to support arbitrary passphrase lengths safely. |
| **TOTP Secret Encryption at Rest** | Planned | TOTP secrets in MongoDB are stored unencrypted (protected by field projection `select: false` and database authentication). Envelope encryption with a dedicated KMS key is planned for future multi-tenant enterprise tiers. |
| **TOTP Single-Use Window Replay Tracking** | Planned | TOTP tokens are valid within a ±1 drift window (90s). Tracking the last verified time-step to prevent code replay within that same window is planned. |
| **Integration Test Suite in CI** | Planned | 178 unit tests execute on mocked repositories and controllers. Full end-to-end integration tests ([`test-integration.js`](file:///d:/Projects/Global_Fit_Ulttra/backend/test-integration.js), [`test-all-endpoints.sh`](file:///d:/Projects/Global_Fit_Ulttra/backend/test-all-endpoints.sh)) run against live databases during manual staging and will be incorporated into CI container service matrices. |
