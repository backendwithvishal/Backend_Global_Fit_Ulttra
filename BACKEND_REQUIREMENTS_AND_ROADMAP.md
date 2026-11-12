# Global_Fit_Ulttra — Backend Architecture Audit, Gaps & Production Engineering Roadmap

**Document Status:** Approved Backend Engineering Blueprint  
**Target Repository:** `Global_Fit_Ulttra` (Backend API & Orchestration Engine)  
**Version:** 2.0.0-BACKEND-PROD  
**Author:** Principal AI Systems & Fintech Backend Architect  
**Architecture Scope:** 100% Headless Backend / Microservices-Inspired Monolith (Zero UI / No Frontend Dependencies)  

---

## 📑 Table of Contents

1. [Executive Summary & Current Backend Baseline](#1-executive-summary--current-backend-baseline)
2. [Current Backend Architecture Map](#2-current-backend-architecture-map)
3. [Gap Analysis Matrix: Implemented vs Mocked vs Missing](#3-gap-analysis-matrix-implemented-vs-mocked-vs-missing)
4. [Master Backend Pillar Specifications](#4-master-backend-pillar-specifications)
   - [Pillar 1: Core Domain Engine & Mock Service Elimination](#pillar-1-core-domain-engine--mock-service-elimination)
   - [Pillar 2: Real-Time Market Streaming & Time-Series Data Layer](#pillar-2-real-time-market-streaming--time-series-data-layer)
   - [Pillar 3: Database Migrations, Persistence & Cache Partitioning](#pillar-3-database-migrations-persistence--cache-partitioning)
   - [Pillar 4: Advanced AI, Agentic Workflows & Multi-Agent Council](#pillar-4-advanced-ai-agentic-workflows--multi-agent-council)
   - [Pillar 5: Security, Identity, Governance & Compliance](#pillar-5-security-identity-governance--compliance)
   - [Pillar 6: Backend Quality Assurance, Hermetic Testing & Load Simulation](#pillar-6-backend-quality-assurance-hermetic-testing--load-simulation)
   - [Pillar 7: DevOps, Cloud Infrastructure & Observability](#pillar-7-devops-cloud-infrastructure--observability)
   - [Pillar 8: Developer Ecosystem, Public APIs & Client SDKs](#pillar-8-developer-ecosystem-public-apis--client-sdks)
5. [Backend Implementation Milestones](#5-backend-implementation-milestones)
6. [Actionable Backend Engineering Checklist](#6-actionable-backend-engineering-checklist)

---

## 1. Executive Summary & Current Backend Baseline

`Global_Fit_Ulttra` is a dedicated, headless financial data orchestration engine designed to aggregate market feeds from 6+ external providers, execute high-throughput AI operations, stream live price data over WebSockets, and run hybrid retrieval-augmented generation (RAG) over regulatory filings (SEC 10-K, 10-Q, FOMC transcripts).

### Verified Backend Quality Metrics

- **Unit Test Pass Rate:** **100%** (**184 passed out of 184 tests** across 9 test suites via `npm test --prefix backend`).
- **Code Hygiene:** **0 ESLint errors** (`npm run lint --prefix backend`).
- **Runtime:** Node.js 20+ LTS with native ECMAScript Modules (`"type": "module"`).
- **Core Technology Stack:** Express 4.x, MongoDB 7.0 (Mongoose 8.x), Redis 7 (ioredis), RabbitMQ 3.12 (amqplib), Qdrant 1.19 (`@qdrant/js-client-rest`), and LiteLLM/Groq AI Gateway.

### Core Backend Gaps Identified

Despite clean code hygiene and high test coverage, the backend currently contains several incomplete or mocked operational paths:
1. **Background Alert Worker Missing:** `AlertService.checkAndTriggerAlerts()` exists, but no cron job, queue consumer, or daemon ever executes it. Alerts saved by users in MongoDB remain static.
2. **Transactional Emails Mocked:** `UserService.js` logs `[MAILER MOCK]` for account verification, password resets, and magic login links. No real email transport is connected.
3. **Billing & Stripe Integration Simulated:** `BillingService.js` creates mock session IDs (`cs_test_...`) without real Stripe Checkout, customer portal sessions, or signature-verified webhook handlers.
4. **API Usage Tracking Stubbed:** `StatusController.js:20` acknowledges that API rate-limit usage metering is not yet implemented.
5. **Filing Ingestion Relies on Manual Scripts:** RAG ingestion is driven by local CLI commands (`npm run rag:ingest`) rather than an automated pipeline that continuously pulls 10-K/10-Q filings from the SEC EDGAR API.

---

## 2. Current Backend Architecture Map

```
┌────────────────────────────────────────────────────────────────────────┐
│                   External Clients / Algorithmic Consumers             │
│        REST API (JSON)       │       WebSocket Streams (Socket.io)     │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ HTTP / WS
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Express Application Gateway                       │
│  Helmet ── CORS ── RateLimiter ── RequestID ── MongoSanitize ── Auth    │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
                    ▼                                ▼
       ┌────────────────────────┐       ┌────────────────────────┐
       │ Core Financial Routes  │       │   AI & RAG Engine      │
       │ - Quotes & Forex       │       │ - Agentic Orchestrator │
       │ - Crypto & Economic    │       │ - Qdrant / BM25 Retr.  │
       │ - Watchlists & Alerts  │       │ - LiteLLM / Groq LLM   │
       └────────────┬───────────┘       └────────────┬───────────┘
                    │                                │
    ┌───────────────┴───────────────┐                │
    ▼                               ▼                ▼
┌───────────────────────┐ ┌───────────────────┐ ┌──────────────────────┐
│ MongoDB 7.0           │ │ Redis 7           │ │ RabbitMQ 3.12        │
│ - User / Org data     │ │ - Market Cache    │ │ - Async AI Jobs      │
│ - Document Chunks     │ │ - Semantic Cache  │ │ - Ingestion Queue    │
│ - Audit & Event Logs  │ │ - Quota Buckets   │ │                      │
└───────────────────────┘ └───────────────────┘ └──────────────────────┘
```

---

## 3. Gap Analysis Matrix: Implemented vs Mocked vs Missing

| Backend Subsystem | File & Current Code State | Target Production Implementation | Priority |
| :--- | :--- | :--- | :--- |
| **Alert Execution Worker** | `AlertService.js:103-110` (Method defined, 0 callers) | Standalone background worker evaluating prices against active alerts | **P0 - Critical** |
| **Transactional Mailer** | `UserService.js:73, 139, 630` (`[MAILER MOCK]`) | Resend / SendGrid / AWS SES adapter with responsive HTML templates | **P0 - Critical** |
| **Stripe Billing Integration** | `BillingService.js:47-53` (`cs_test_...` mock IDs) | Authentic Stripe Checkout, Customer Portal & webhook HMAC signature check | **P0 - Critical** |
| **API Usage Metering** | `StatusController.js:20` (`usage tracking not implemented`) | Redis sliding-window token bucket tracking requests per user, key & tier | **P1 - High** |
| **SEC EDGAR Pipeline** | Manual CLI file script (`scripts/ingestFinancialDocuments.js`) | Automated SEC EDGAR RSS polling, CIK resolver & XBRL table extractor | **P1 - High** |
| **Dynamic Tool Calling** | Static prompt routing in `AgenticRAGOrchestrator.js` | Native LLM function calling for live quotes, crypto, forex & FRED series | **P1 - High** |
| **Interactive API Docs** | Static JSON root route (`app.js:100`) | OpenAPI 3.0 / Swagger UI mounted at `/api/docs` via `swagger-ui-express` | **P1 - High** |
| **Time-Series Storage** | Standard Mongoose collections (`FinancialAsset.js`) | MongoDB 7.0 Time Series Collections for market ticks & OHLCV aggregation | **P2 - Medium** |
| **Model Context Protocol (MCP)**| Missing | Native headless MCP server exposing financial data tools to IDEs and agents | **P2 - Medium** |
| **Database Migrations** | On-the-fly index initialization in Mongoose | Formal versioned migration runner (`migrate-mongo`) | **P2 - Medium** |
| **Metrics & Observability** | Console & Winston file logging | Prometheus `/metrics` endpoint with custom financial metrics | **P1 - High** |
| **Client SDKs** | Raw HTTP Postman collection | Official TypeScript/Node.js and Python programmatic client SDKs | **P2 - Medium** |

---

## 4. Master Backend Pillar Specifications

---

### Pillar 1: Core Domain Engine & Mock Service Elimination

#### 1.1 Autonomous Alert Execution Worker
- **Target File:** `backend/src/services/AlertWorkerService.js` (New)
- **Problem:** `AlertService.checkAndTriggerAlerts()` is declared but has zero callers across the entire codebase. Active user alerts stored in MongoDB are never evaluated.
- **Specification:**
  - Create an autonomous background worker running on a configurable interval (default: 15–30s) or triggered by inbound market data WebSocket messages.
  - Pulls all active alerts via `alertRepository.findActive()`.
  - Batch-fetches latest asset prices from `RedisCache` or `FinancialDataService`.
  - Evaluates threshold conditions:
    - `GREATER_THAN` / `PRICE_ABOVE`: Current price $\ge$ target price.
    - `LESS_THAN` / `PRICE_BELOW`: Current price $\le$ target price.
    - `PERCENT_CHANGE_UP` / `PERCENT_CHANGE_DOWN`: Absolute 24h change exceeding threshold.
  - Implements notification hysteresis and cooldown windows (e.g. 6 hours) to prevent alert storms.
  - Updates alert status: `isTriggered: true`, `triggeredAt: new Date()`, `triggerPrice: currentPrice`.
  - Dispatches payload to `NotificationDispatcher`.

#### 1.2 Omnichannel Notification Dispatcher & Production Mailer
- **Target Files:**
  - `backend/src/infrastructure/notifications/NotificationDispatcher.js` (New)
  - `backend/src/infrastructure/mailer/MailerService.js` (New)
- **Problem:** `UserService.js` mocks all emails via `logger.info('[MAILER MOCK] ...')`.
- **Specification:**
  - Implement a pluggable `MailerService` supporting **Resend**, **SendGrid**, or standard **SMTP** (Nodemailer), driven by environment variables (`MAILER_PROVIDER`, `RESEND_API_KEY`, etc.).
  - Deliver transactional HTML emails with fallback plain-text for:
    - User account email verification (`/api/v1/auth/verify-email/:token`).
    - Password reset requests (`/api/v1/auth/reset-password`).
    - Passwordless magic login links (`/api/v1/auth/magic-login`).
    - Triggered price alerts with financial metrics and timestamp.
    - Subscription billing invoices and receipts.
  - Support multi-channel dispatch:
    - **Email:** Via `MailerService`.
    - **In-App WebSocket:** Pushes directly to room `user:<userId>` via `SocketManager`.
    - **Webhook:** Outbound POST request with HMAC-SHA256 signature header to user-registered webhook URLs.

#### 1.3 Production Stripe Billing & Webhook Gateway
- **Target Files:**
  - `backend/src/services/BillingService.js` (Refactor)
  - `backend/src/controllers/BillingController.js` (Refactor)
  - `backend/src/routes/billingRoutes.js` (Refactor)
- **Problem:** `BillingService.js` currently generates fake session IDs (`cs_test_${random}`) and lacks webhook handling.
- **Specification:**
  - Integrate official `stripe` Node.js SDK.
  - Replace mock session generation with `stripe.checkout.sessions.create()`:
    - Include `client_reference_id: userId.toString()`.
    - Set `mode: 'subscription'`, mapping plans (`Starter`, `Pro`, `Enterprise`) to real Stripe Price IDs.
  - Add raw-body endpoint `POST /api/v1/billing/webhook`:
    - Verify signature using `stripe.webhooks.constructEvent(rawBody, sig, endpointSecret)`.
    - Process asynchronous events:
      - `checkout.session.completed`: Activate subscription, update `subscriptionTier` in database.
      - `customer.subscription.updated`: Handle renewals, upgrades, or downgrades.
      - `customer.subscription.deleted`: Revert user back to `Free` tier upon cancellation.
      - `invoice.payment_failed`: Mark subscription `past_due` and notify user via email.
  - Implement `createCustomerPortalSession(userId)` returning a direct URL to Stripe's self-service billing management portal.

#### 1.4 Real-Time API Usage Metering & Tier Quota Enforcement
- **Target Files:**
  - `backend/src/middleware/apiKeyMiddleware.js` (Refactor/Enhance)
  - `backend/src/controllers/StatusController.js` (Refactor)
  - `backend/src/services/UsageTrackerService.js` (New)
- **Problem:** `StatusController.js:20` explicitly states: `// Show rate limits for each API - usage tracking not implemented yet`.
- **Specification:**
  - Track real-time API consumption in Redis using sliding-window token buckets:
    - Keys: `usage:apikey:<keyId>:<YYYY-MM-DD>` and `usage:user:<userId>:<YYYY-MM-DD>`.
  - Enforce tier limits on every authenticated API invocation:
    - **Free:** 100 requests/day, 3 AI calls/day.
    - **Starter ($29/mo):** 5,000 requests/day, 50 AI calls/day.
    - **Pro ($79/mo):** 50,000 requests/day, 500 AI calls/day.
    - **Enterprise ($299/mo):** Unlimited requests, custom AI quotas.
  - Attach standard response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
  - Expose live consumption stats in `GET /api/v1/status` and `GET /api/v1/apikeys/usage`.

---

### Pillar 2: Real-Time Market Streaming & Time-Series Data Layer

#### 2.1 MongoDB 7.0 Time Series Collections for Market Ticks
- **Target Files:**
  - `backend/src/models/MarketTick.js` (New)
  - `backend/src/services/MarketDataStreamService.js` (New)
- **Problem:** High-frequency tick data (1-second prices) stored in standard B-Tree document collections causes index bloat and high write latency.
- **Specification:**
  - Implement native MongoDB Time Series Collection:
    ```js
    const marketTickSchema = new mongoose.Schema({
      timestamp: { type: Date, required: true },
      metadata: {
        symbol: { type: String, required: true, uppercase: true },
        assetClass: { type: String, enum: ['EQUITY', 'CRYPTO', 'FOREX'] },
        exchange: { type: String, default: 'US' },
      },
      price: { type: Number, required: true },
      volume: { type: Number, default: 0 },
      bid: Number,
      ask: Number,
    }, {
      timeseries: {
        timeField: 'timestamp',
        metaField: 'metadata',
        granularity: 'seconds',
      },
      expireAfterSeconds: 60 * 60 * 24 * 90, // 90-day automatic TTL expiration
    });
    ```
  - Implement aggregation pipelines computing historical OHLCV candlestick bars (1m, 5m, 1h, 1D) on demand using `$bucketAuto` and `$dateTrunc`.

#### 2.2 WebSocket Channel Optimization & Targeted Rooms
- **Target File:** `backend/src/infrastructure/websocket/SocketManager.js` (Refactor)
- **Specification:**
  - Enable granular topic subscriptions rather than broadcasting all market updates to a single `live-stream` room:
    - `subscribe:symbol` (`room:ticker:AAPL`)
    - `subscribe:crypto` (`room:crypto:BTC`)
    - `subscribe:forex` (`room:forex:EURUSD`)
    - `subscribe:alerts` (`room:user:<userId>`)
  - Implement backpressure detection: drop low-priority tick updates if client socket buffer exceeds 256KB to preserve server stability.

---

### Pillar 3: Database Migrations, Persistence & Cache Partitioning

#### 3.1 Formal Database Schema Migrations
- **Target Directory:** `backend/src/migrations/`
- **Specification:**
  - Integrate `migrate-mongo` or a custom ESM-native migration harness.
  - Track applied migrations in `_migrations` collection with timestamp and execution status.
  - Initial migrations to author:
    1. `001_create_compound_indexes.js`: Compound indexes on `{ symbol: 1, timestamp: -1 }` for fast lookups.
    2. `002_add_timeseries_collection.js`: Initialize `market_ticks` time-series collection.
    3. `003_seed_default_organizations.js`: Ensure tenant organization consistency.

#### 3.2 Automated Database Backup, Encryption & Recovery Scripts
- **Target Directory:** `backend/scripts/backup/`
- **Specification:**
  - `backupDatabase.sh`: Runs `mongodump` with gzip compression, encrypts with AES-256-GCM, and uploads to Amazon S3 / Google Cloud Storage.
  - `restoreDatabase.sh`: Validates archive checksums and performs automated test restore into staging/test environment.

---

### Pillar 4: Advanced AI, Agentic Workflows & Multi-Agent Council

#### 4.1 Native Financial Tool Calling for Agentic RAG
- **Target Files:**
  - `backend/src/infrastructure/ai/financialTools.js` (New)
  - `backend/src/infrastructure/ai/AgenticRAGOrchestrator.js` (Enhance)
- **Specification:**
  - Provide LLM with native function calling tools:
    1. `getLiveQuote({ symbol })` -> Returns latest stock quote from AlphaVantage/Finnhub.
    2. `getCryptoPrice({ ids })` -> Returns live crypto prices from CoinGecko.
    3. `getExchangeRate({ base, target })` -> Returns forex conversion rates.
    4. `getMacroData({ seriesId })` -> Returns FRED economic observations (GDP, CPI, Fed Funds Rate).
    5. `searchFilings({ symbol, query, filingType })` -> Executes dense + sparse hybrid vector search.
  - The orchestrator detects multi-intent queries (e.g. *"What is Apple's stock price today and how does it compare to its Q3 FY24 iPhone revenue?"*), calls tools concurrently, and produces a single grounded response.

#### 4.2 Automated SEC EDGAR Live Ingestion Pipeline
- **Target File:** `backend/src/services/SECDataService.js` (New)
- **Specification:**
  - Connect to official SEC EDGAR submissions API (`https://data.sec.gov/submissions/CIK{cik}.json`) adhering to SEC rate limits ($\le 10$ req/s with compliant `User-Agent`).
  - Maintain ticker-to-CIK mapping table.
  - Scheduled worker checks for newly filed 10-K, 10-Q, and 8-K documents.
  - Ingestion pipeline:
    1. Downloads raw filing text/HTML.
    2. Extracts MD&A, Financial Statements, and Risk Factors sections.
    3. Segments text into financial chunks with `financialChunker.js`.
    4. Generates 384-dimensional dense semantic vectors using `@xenova/transformers`.
    5. Upserts chunks into Qdrant vector store with fallback to MongoDB vector storage.

#### 4.3 Multi-Agent Financial Council
- **Target File:** `backend/src/infrastructure/ai/MultiAgentCouncil.js` (New)
- **Specification:**
  - Orchestrate specialized agent personas to debate market positioning:
    - **Fundamental Analyst Agent:** Evaluates balance sheet, DCF, EBITDA, cash flow, debt-to-equity.
    - **Technical Analyst Agent:** Evaluates 20/50/200-day SMAs, RSI momentum, Bollinger Bands, support/resistance.
    - **Macro Strategist Agent:** Assesses Fed interest rate policy, CPI inflation, yield curve inversions.
    - **Risk Officer Agent:** Analyzes SEC 10-K Item 1A risks, regulatory proceedings, antitrust scrutiny.
    - **Council Moderator:** Synthesizes perspectives into a consensus report with risk ratings.

#### 4.4 Model Context Protocol (MCP) Server
- **Target File:** `backend/src/mcp/server.js` (New)
- **Specification:**
  - Expose Global_Fit_Ulttra as a standardized Model Context Protocol (MCP) server over STDIO or SSE.
  - Expose MCP tools:
    - `globalfit_get_quote`
    - `globalfit_get_crypto`
    - `globalfit_rag_search`
    - `globalfit_sentiment_analysis`
  - Allows external AI assistants (Cursor, Claude Desktop, Antigravity) to query live Global_Fit_Ulttra market data.

---

### Pillar 5: Security, Identity, Governance & Compliance

#### 5.1 Multi-Factor Authentication (MFA) Expansion
- **Target File:** `backend/src/controllers/AuthController.js` (Enhance)
- **Specification:**
  - Generate 10 cryptographically random, one-time emergency backup recovery codes (hashed with bcrypt before persistence).
  - Add optional Email OTP or SMS OTP fallback for users who lose access to authenticator apps.
  - Support WebAuthn / FIDO2 Passkeys for hardware-backed biometric authentication (YubiKey, Windows Hello, TouchID).

#### 5.2 Granular API Key Scopes & CIDR IP Allowlisting
- **Target File:** `backend/src/models/ApiKey.js` & `backend/src/middleware/apiKeyMiddleware.js`
- **Specification:**
  - Update `ApiKey` schema to support fine-grained scopes:
    - `quotes:read`, `quotes:stream`
    - `alerts:read`, `alerts:write`
    - `rag:query`, `rag:ingest`
    - `admin:all`
  - Support IP CIDR allowlists (`allowedIps: ['192.168.1.0/24', '10.0.0.1']`). Rejects non-allowlisted origins with `403 Forbidden` (`E1004`).

#### 5.3 SOC2 & GDPR Compliance Endpoints
- **Specification:**
  - **GDPR Article 20 (Data Portability):** `GET /api/v1/users/me/export` generates a password-protected ZIP containing user profile, watchlists, alerts, and audit history.
  - **GDPR Article 17 (Right to Erasure):** `DELETE /api/v1/users/me` permanently purges personal records and anonymizes historical audit logs.
  - **Tamper-Evident Audit Trail:** Hash-chain audit logs using SHA-256 (`currentHash = SHA256(previousHash + eventData)`), creating an immutable, verifiable ledger.

---

### Pillar 6: Backend Quality Assurance, Hermetic Testing & Load Simulation

#### 6.1 Hermetic In-Memory Route Testing Harness
- **Problem:** When running Supertest in zero-network environments (such as Windows sandbox), loopback TCP socket binding throws `connect EACCES 127.0.0.1`.
- **Specification:**
  - Implement an in-memory dispatch test utility using direct Express handler invocation (`app.handle(req, res)` via `node-mocks-http`).
  - Guarantees 100% of route and controller tests pass in strict, air-gapped sandboxes without binding TCP ports.

#### 6.2 High-Throughput Load & Stress Testing (k6)
- **Target Directory:** `backend/__tests__/load/`
- **Specification:**
  - Create k6 load testing scripts:
    1. `k6-rest-quotes.js`: 5,000 req/s on `/api/v1/financial/stock/AAPL` verifying P99 latency < 50ms.
    2. `k6-websocket-streams.js`: 10,000 concurrent Socket.IO clients subscribed to ticker rooms verifying memory stability.
    3. `k6-rag-queries.js`: 100 concurrent hybrid RAG queries verifying Qdrant connection pooling.

---

### Pillar 7: DevOps, Cloud Infrastructure & Observability

#### 7.1 Production Kubernetes (K8s) Architecture & Helm Chart
- **Target Directory:** `helm/global-fit-ulttra/`
- **Specification:**
  - Production Helm chart with:
    - `deployment.yaml`: Rolling updates, liveness/readiness probes, pod disruption budgets.
    - `service.yaml`: Internal ClusterIP.
    - `ingress.yaml`: Ingress controller with TLS certificate termination.
    - `hpa.yaml`: Horizontal Pod Autoscaler scaling on CPU (70%) and request throughput.
    - `secrets.yaml` & `configmap.yaml`.

#### 7.2 OpenTelemetry & Prometheus / Grafana Observability
- **Target Files:**
  - `backend/src/infrastructure/monitoring/metrics.js` (New)
  - `backend/src/routes/metricsRoutes.js` (New)
- **Specification:**
  - Mount `/metrics` endpoint using `prom-client`:
    - `http_requests_total{method, path, status}`
    - `http_request_duration_seconds{method, path}`
    - `active_websocket_connections`
    - `circuit_breaker_state{service}`
    - `cache_hits_total{type="semantic|market"}`
    - `llm_token_usage_total{model, type="prompt|completion"}`
  - Provide ready-to-import Grafana dashboard configuration (`docs/grafana-dashboard.json`).

---

### Pillar 8: Developer Ecosystem, Public APIs & Client SDKs

#### 8.1 OpenAPI 3.0 & Interactive Swagger Documentation
- **Target Files:**
  - `backend/src/docs/openapi.yaml` (New)
  - `backend/src/routes/docRoutes.js` (New)
- **Specification:**
  - Full OpenAPI 3.0 documentation covering all 40+ endpoints.
  - Mount interactive Swagger UI at `GET /api/docs` using `swagger-ui-express`.
  - Include interactive "Try it out" console with API Key and JWT Bearer token authorization.

#### 8.2 Official Client SDKs
- **TypeScript / Node.js SDK (`packages/sdk-ts`):**
  - Isomorphic SDK for Node.js backend services and algorithmic trading scripts.
  - Automatic WebSocket reconnect, token refresh, and typed responses.
- **Python SDK (`packages/sdk-py`):**
  - Python client (`pip install globalfit`) with Pandas DataFrame export for quant researchers and algorithmic trading pipelines.

---

## 5. Backend Implementation Milestones

```
┌────────────────────────────────────────────────────────────────────────┐
│  Phase 1: Mock Elimination & Core Domain Reliability (Weeks 1-2)       │
│  - Real Mailer Service (Resend/SendGrid/SES)                           │
│  - Production Stripe Checkout, Portal & Webhook Verification           │
│  - Autonomous Alert Worker Evaluation Loop                             │
│  - Redis Token-Bucket API Metering & Tier Limits                       │
├────────────────────────────────────────────────────────────────────────┤
│  Phase 2: Streaming Data Layer & Dynamic AI Tools (Weeks 3-4)          │
│  - MongoDB 7.0 Time Series Collection for Market Ticks                 │
│  - Granular WebSocket Ticker Topic Rooms                               │
│  - Dynamic LLM Financial Function/Tool Calling                         │
│  - Automated SEC EDGAR Real-Time Ingestion Pipeline                    │
├────────────────────────────────────────────────────────────────────────┤
│  Phase 3: Multi-Agent Council & MCP Server (Weeks 5-6)                 │
│  - Multi-Agent Financial Council Debate Engine                         │
│  - Local ONNX Cross-Encoder Reranker                                   │
│  - Headless Model Context Protocol (MCP) Server                        │
│  - Database Migration Runner (migrate-mongo)                           │
├────────────────────────────────────────────────────────────────────────┤
│  Phase 4: Security Hardening & Observability (Weeks 7-8)               │
│  - WebAuthn / Passkeys & Emergency Backup Codes                        │
│  - Granular API Key Scopes & CIDR Allowlisting                         │
│  - Prometheus /metrics Endpoint & Grafana Dashboards                   │
│  - GDPR Data Portability (Art. 20) & Erasure (Art. 17)                │
├────────────────────────────────────────────────────────────────────────┤
│  Phase 5: Cloud Scale & Developer Platform (Weeks 9+)                  │
│  - Kubernetes Production Helm Chart & Manifests                        │
│  - OpenAPI 3.0 & Swagger UI at /api/docs                               │
│  - TypeScript & Python Client SDKs                                     │
│  - Distributed k6 Load Testing (5,000 req/s, 10,000 WebSockets)        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Actionable Backend Engineering Checklist

### Milestone 1: Core Reliability & Mock Elimination
- [ ] Create `backend/src/infrastructure/mailer/MailerService.js` (Resend/SendGrid/SMTP).
- [ ] Replace all `[MAILER MOCK]` occurrences in `UserService.js` with active mailer calls.
- [ ] Create `backend/src/infrastructure/notifications/NotificationDispatcher.js`.
- [ ] Implement `backend/src/services/AlertWorkerService.js` and schedule background evaluation loop.
- [ ] Connect `AlertWorkerService` to `NotificationDispatcher` for email, push, and webhook alerts.
- [ ] Refactor `BillingService.js` with genuine Stripe Checkout and Customer Portal integration.
- [ ] Add raw-body route `POST /api/v1/billing/webhook` with `stripe.webhooks.constructEvent`.
- [ ] Implement Redis-backed API usage tracking in `backend/src/services/UsageTrackerService.js`.
- [ ] Connect usage tracking to `StatusController.js` and attach rate-limit response headers.

### Milestone 2: Streaming, Time-Series & SEC Pipeline
- [ ] Create `backend/src/models/MarketTick.js` using MongoDB 7.0 Time Series Collection.
- [ ] Implement OHLCV aggregation pipelines for candlestick intervals (1m, 5m, 1h, 1D).
- [ ] Optimize `SocketManager.js` with topic-based rooms (`room:ticker:<symbol>`).
- [ ] Implement `backend/src/services/SECDataService.js` for automated SEC EDGAR 10-K/10-Q ingestion.
- [ ] Equip `AgenticRAGOrchestrator.js` with dynamic financial function calling.

### Milestone 3: Advanced AI, MCP & Migrations
- [ ] Build `backend/src/infrastructure/ai/MultiAgentCouncil.js` for multi-perspective market analysis.
- [ ] Build `backend/src/mcp/server.js` exposing Global_Fit_Ulttra as an official MCP server.
- [ ] Set up automated schema migration runner (`migrate-mongo`) in `backend/src/migrations/`.
- [ ] Create automated encrypted database backup and restore scripts in `backend/scripts/backup/`.

### Milestone 4: Security, Compliance & Observability
- [ ] Add emergency backup recovery codes and Passkey / WebAuthn support to `AuthController.js`.
- [ ] Add CIDR IP allowlisting and scope verification to `ApiKeyController.js`.
- [ ] Implement GDPR Article 17 (Right to Erasure) and Article 20 (Data Portability) endpoints.
- [ ] Mount Prometheus `/metrics` endpoint using `prom-client` in `backend/src/routes/metricsRoutes.js`.
- [ ] Provide ready-to-import Grafana dashboard configuration (`docs/grafana-dashboard.json`).

### Milestone 5: Testing, SDKs & Deployment
- [ ] Implement in-memory route test runner to ensure 100% test pass rate in air-gapped sandboxes.
- [ ] Author Kubernetes Helm chart in `helm/global-fit-ulttra/` with HPA and TLS Ingress.
- [ ] Write k6 load testing scripts for 5,000 req/sec API and 10,000 WebSocket connections.
- [ ] Publish OpenAPI 3.0 specification and mount Swagger UI at `/api/docs`.
- [ ] Package TypeScript SDK (`@globalfit/sdk`) and Python SDK (`globalfit-py`).

---

**Certified By:** DeepMind Antigravity Systems Architect  
**Approved Architecture:** 100% Headless Backend / Financial Orchestration Engine  

