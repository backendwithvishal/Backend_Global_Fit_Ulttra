# Global_Fit_Ulttra — Advanced Agentic Hybrid Financial RAG Subsystem

> **Architecture, Implementation & Operations Manual**  
> Complete documentation for the Production Agentic RAG Orchestrator, Qdrant Vector Engine, BM25 Lexical Retrieval, Reciprocal Rank Fusion, Genuine Semantic Embeddings, Multi-Tenant Semantic Cache, and Grounded Generation.

---

## 1. Executive Summary

Global_Fit_Ulttra features an enterprise-grade **Agentic Hybrid Financial RAG (Retrieval-Augmented Generation) Subsystem** built for financial research, statutory filings analysis, and regulatory disclosure synthesis.

### Core Engineering Advancements

1. **Genuine Semantic Local Embeddings**:
   - Integrated `@xenova/transformers` running `Xenova/all-MiniLM-L6-v2` locally on CPU.
   - Produces authentic 384-dimensional dense semantic vectors with L2 unit normalization at **$0.00 cloud inference cost**.
   - Zero external embedding billing or rate limits; fully functional offline.

2. **Dedicated Vector Store & Resilient Storage Abstraction**:
   - **Primary Vector Store**: **Qdrant** (`@qdrant/js-client-rest`) with payload indexing (`organizationId`, `symbol`, `filingType`, `reportingPeriod`), deterministic UUID v5 point IDs, and collection auto-provisioning.
   - **Seamless Fallback**: Native MongoDB Atlas Vector Search (`$vectorSearch`) and in-database cosine similarity vector scoring if Qdrant is unavailable.

3. **Hybrid Lexical Retrieval & Reciprocal Rank Fusion (RRF)**:
   - **Okapi BM25 Sparse Search**: Native implementation (`BM25Retriever.js`) with term frequency saturation ($k_1 = 1.2$), document length normalization ($b = 0.75$), inverse document frequency (IDF), and specialized ticker/metric term boosting.
   - **Reciprocal Rank Fusion**: Non-linear rank-based fusion combining dense vector similarity (65% default weight) and sparse BM25 scores (35% default weight) with rank smoothing constant $k = 60$.

4. **Agentic RAG Orchestration & Anti-Hallucination Guardrails**:
   - **Intent Classification**: Categorizes user requests into `FINANCIAL_FILING_QA`, `LIVE_MARKET_DATA`, `COMPARISON_SYNTHESIS`, `GENERAL_FINANCIAL_CONCEPT`, or `UNSUPPORTED`.
   - **Query Routing**: Routes live pricing and quote inquiries to market data providers rather than filing vector indexes.
   - **Query Planning & Decomposition**: Deconstructs multi-ticker comparative queries into bounded sub-retrievals.
   - **Evidence Sufficiency Gating**: Inspects retrieved chunks before generation; explicitly refuses or states evidentiary limits if source material is insufficient.
   - **Strict Citation Validation**: Validates that all citations refer to actual indexed document chunks (`[Source 1: AAPL 10-Q]`).

5. **Multi-Tenant Security & Cache Isolation**:
   - Semantic query caching partitioned by `organizationId`, preventing cross-tenant leakage.
   - Document-level and tenant-level access control enforced prior to vector retrieval.

6. **Optional Enterprise Integrations**:
   - **Portkey AI Gateway**: Configurable upstream model gateway with budget tracking, retry policies, and zero-cost passthrough fallback.
   - **LangSmith Tracing**: End-to-end tracing across classification, planning, retrieval, RRF, and generation stages, disabled by default for zero expense.

---

## 2. End-to-End Architecture

```mermaid
flowchart TD
    subgraph Ingestion["1. Secure Ingestion & Indexing Pipeline"]
        DOCS["Financial PDFs: SEC 10-K, 10-Q, FOMC, Reports"] --> PARSER["PDF Text Extractor (pdf-parse / Uint8Array)"]
        PARSER --> CHUNKER["Financial Chunker (financialChunker.js)"]
        CHUNKER --> EMBED["Local Semantic Embeddings (all-MiniLM-L6-v2, 384 dims)"]
        EMBED --> DUAL_STORE{"Vector Store Router"}
        DUAL_STORE -- "Primary" --> QDRANT[("Qdrant Vector DB: financial_chunks")]
        DUAL_STORE -- "Fallback" --> MONGO[("MongoDB: Document & DocumentChunk")]
    end

    subgraph AgenticOrchestration["2. Agentic Query Understanding & Planning"]
        USER_Q["User Question"] --> ORCHESTRATOR["Agentic RAG Orchestrator"]
        ORCHESTRATOR --> CLASSIFIER["Intent Classifier & Entity Extractor"]
        CLASSIFIER --> ROUTING{"Intent Type"}
        ROUTING -- "LIVE_MARKET_DATA" --> LIVE_SERVICE["FinancialDataService (Quotes/APIs)"]
        ROUTING -- "UNSUPPORTED" --> SAFE_REFUSAL["Safe Non-Hallucinatory Refusal"]
        ROUTING -- "FILING_QA / COMPARISON" --> PLANNER["Query Decomposition & Multi-Query Planner"]
    end

    subgraph HybridRetrieval["3. Hybrid Retrieval & Fusion"]
        PLANNER --> CACHE{"Multi-Tenant Semantic Cache (Redis)"}
        CACHE -- "Hit (<10ms)" --> CACHED_RES["Direct Grounded Response"]
        CACHE -- "Miss" --> DENSE_SEARCH["Dense Semantic Vector Search (Qdrant/Mongo)"]
        PLANNER --> SPARSE_SEARCH["Sparse Lexical Keyword Search (Okapi BM25)"]
        DENSE_SEARCH --> RRF["Reciprocal Rank Fusion (RRF: Dense 65% + Sparse 35%)"]
        SPARSE_SEARCH --> RRF
        RRF --> RERANK["Cross-Encoder Reranker & Evidence Filter"]
    end

    subgraph GroundedSynthesis["4. Evidence Sufficiency & Grounded Generation"]
        RERANK --> SUFFICIENCY{"Evidence Sufficiency Check (Score >= 0.40)"}
        SUFFICIENCY -- "Insufficient" --> REFUSAL["Honest Evidence Limitation Disclosure"]
        SUFFICIENCY -- "Sufficient" --> PROMPT["Grounded Context Assembly"]
        PROMPT --> GATEWAY{"Portkey AI Gateway / Direct Groq"}
        GATEWAY --> GROQ["Groq LLM (LLaMA 3.3 70B Versatile)"]
        GROQ --> VALIDATOR["Citation Validator & Sanitizer"]
        VALIDATOR --> STREAM["Socket.IO Token Stream / HTTP REST Response"]
        STREAM --> CACHE_WRITE["Write to Semantic Cache (Scoped to Tenant)"]
    end
```

---

## 3. Financial Document Ingestion Pipeline

### Supported Documents & Verified Corpus

The local repository includes verified financial filings in `backend/data/financial_documents/`:

| Document Filename | Entity | Filing | Verified Financial Content |
| :--- | :---: | :---: | :--- |
| **`AAPL_FY24_Q3_Financial_Filing.pdf`** | Apple Inc. | `10-Q` | Net sales ($85.78B), iPhone ($39.30B), Services record ($24.21B), Gross margin (46.3%), European DMA regulatory risk. |
| **`MSFT_FY24_Annual_Financial_Review.pdf`** | Microsoft Corp. | `10-K` | Consolidated revenue ($245.1B), Intelligent Cloud ($105.4B), Azure growth (+30%, 8 pts from AI), RPO ($269B), CapEx ($55.7B). |
| **`NVDA_FY24_Data_Center_Financial_Report.pdf`** | NVIDIA Corp. | `10-K` | Record revenue ($60.92B, +126%), Data Center ($47.41B, +217%), Gross margin (72.7%), HGX Hopper H100/H200, TSMC CoWoS packaging supply chain risks. |
| **`TSLA_FY24_Shareholder_Update.pdf`** | Tesla, Inc. | `10-K` | Vehicle deliveries (1,808,581), energy storage deployments (14.72 GWh, +125%), operating margin (18.2%), Dojo supercomputer. |
| **`FED_FOMC_Statement_2024.pdf`** | Federal Reserve | `FOMC` | Federal funds target range (5.25%–5.50%), inflation target (2.0%), quantitative tightening balance sheet roll-off. |
| **`SEC_Form_10K_Guidelines.pdf`** | SEC EDGAR | `GUIDE` | Official SEC Form 10-K disclosure requirements, Item 1A Risk Factors, Item 7 MD&A statutory standards. |

### Ingestion Features

1. **Path Traversal Protection**: Rejects file paths navigating outside `data/financial_documents` or the server workspace.
2. **Document Hashing**: Calculates SHA-256 hashes to prevent redundant processing.
3. **Financial-Aware Chunking (`financialChunker.js`)**:
   - Preserves table rows, labels, units, and currency signs without breaking numbers.
   - Detects statutory sections (Item 1A Risk Factors, Item 7 MD&A, Financial Statements).
4. **Dual Vector Synchronization**: Automatically upserts chunks to Qdrant if active, and maintains full MongoDB document chunk records.
5. **Background Messaging**: Emits jobs to the RabbitMQ `rag_ingest` queue for asynchronous processing.

---

## 4. REST API Reference

All endpoints are mounted at `/api/v1/ai/rag` with backward-compatible aliases at `/api/v1/rag`.

### 1. Grounded RAG Query
**`POST /api/v1/ai/rag/query`**

Execute an agentic, grounded financial inquiry.

#### Request Body
```json
{
  "question": "What were Apple's Services revenue and iPhone revenue in Q3 2024?",
  "symbol": "AAPL",
  "topK": 4,
  "bypassCache": false
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "answer": "In Q3 2024, Apple reported Services revenue of $24.21 billion [Source 1], a 14% year-over-year increase. iPhone revenue was $39.30 billion [Source 1], representing a 1% decrease from Q3 2023.",
    "citations": [
      {
        "sourceId": 1,
        "title": "Apple Inc Form 10-Q Quarterly Report",
        "symbol": "AAPL",
        "filingType": "10-Q",
        "section": "Statements of Operations",
        "pageNumber": 1,
        "relevanceScore": 0.98,
        "snippet": "Revenue by Product Category: iPhone $39,296M (-1%), Services $24,213M (+14%)..."
      }
    ],
    "symbol": "AAPL",
    "confidence": 98,
    "retrievalCount": 2,
    "latencyMs": 28,
    "cached": false
  },
  "requestId": "req-1728860000000"
}
```

---

### 2. Ingest Document
**`POST /api/v1/ai/rag/ingest`**

Ingest a single financial PDF document or trigger indexing across a directory.

#### Request Body
```json
{
  "filePath": "./data/financial_documents/AAPL_FY24_Q3_Financial_Filing.pdf",
  "symbol": "AAPL",
  "filingType": "10-Q",
  "isPublic": true
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "documentId": "6ace7827f056d614bedc96d8",
    "title": "Apple Inc Form 10-Q Quarterly Report",
    "filename": "AAPL_FY24_Q3_Financial_Filing.pdf",
    "symbol": "AAPL",
    "filingType": "10-Q",
    "chunkCount": 2,
    "tokenCount": 658,
    "status": "indexed",
    "durationMs": 398
  },
  "message": "Financial documents processed and indexed into vector repository",
  "requestId": "req-1728860000001"
}
```

---

### 3. Vector Subsystem Health & Readiness
**`GET /api/v1/ai/rag/health`**

Inspect readiness across Vector Store, Embedding Client, Semantic Cache, and AI Gateway.

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "status": "ready",
    "service": "Global_Fit_Ulttra Financial RAG Subsystem",
    "vectorStore": {
      "provider": "qdrant",
      "healthy": true,
      "collection": "financial_chunks",
      "pointsCount": 32
    },
    "embedding": {
      "provider": "local",
      "model": "Xenova/all-MiniLM-L6-v2",
      "dimensions": 384
    },
    "cache": {
      "enabled": true,
      "healthy": true
    },
    "gateway": {
      "portkeyEnabled": false,
      "langsmithTracing": false
    }
  }
}
```

---

### 4. Background Job Status
**`GET /api/v1/ai/rag/jobs/:jobId`**

Query the progress of an asynchronous document ingestion job.

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "jobId": "job-1728860000000",
    "status": "completed",
    "progress": 100,
    "processedChunks": 2,
    "totalChunks": 2
  }
}
```

---

### 5. Reindex Vector Knowledge Base
**`POST /api/v1/ai/rag/reindex`**

Re-embed and re-index all MongoDB document chunks into Qdrant.

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "reindexedCount": 32,
    "durationMs": 842,
    "vectorStore": "qdrant"
  },
  "message": "Reindexed 32 chunks into vector store"
}
```

---

### 6. List Indexed Documents
**`GET /api/v1/ai/rag/documents?symbol=AAPL&page=1&limit=20`**

Retrieve indexed document records, chunk counts, and metadata.

---

### 7. Vector Knowledge Base Statistics
**`GET /api/v1/ai/rag/stats`**

Retrieve aggregate chunk counts, covered symbols, and vector dimensions.

---

## 5. Real-Time Socket.IO Streaming Interface

Clients connect over WebSocket to receive streaming tokens and instant citation cards.

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', { transports: ['websocket'] });

// Emit Grounded RAG query
socket.emit('ai:rag:query', {
  question: 'What were Microsoft Azure cloud revenue growth and AI contributions?',
  symbol: 'MSFT',
  sessionId: 'client-session-101'
});

// Event 1: Citations received immediately upon retrieval completion
socket.on('ai:rag:citations', ({ sessionId, citations }) => {
  console.log('Verified Citations:', citations);
});

// Event 2: Stream tokens incrementally
socket.on('ai:stream:chunk', ({ sessionId, chunk }) => {
  process.stdout.write(chunk);
});

// Event 3: Complete event
socket.on('ai:stream:complete', ({ sessionId, citations }) => {
  console.log('\nStream completed.');
});

// Event 4: Stream error
socket.on('ai:stream:error', ({ sessionId, error }) => {
  console.error('Streaming error:', error);
});
```

---

## 6. Comprehensive Financial RAG Evaluation Subsystem

Global_Fit_Ulttra includes a dedicated, measurable, reference-backed evaluation framework designed specifically for financial RAG pipelines.

### Supported Evaluation Metric Suites

| Category | Metric Name | Required Inputs | Scoring Method | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Retrieval** | `context_precision` | `retrievedChunks`, `referenceContextIds` | Reference-based (0.0–1.0) | Mean reciprocal precision weighted by relevance at each rank up to Top-K. |
| **Retrieval** | `context_recall` | `retrievedChunks`, `referenceAnswer`/claims | Deterministic token coverage (0.0–1.0) | Proportion of reference facts/claims supported in the retrieved context. |
| **Retrieval** | `context_entities_recall` | `retrievedChunks`, `referenceEntities` | Deterministic entity matching (0.0–1.0) | Proportion of required financial entities (tickers, metrics, periods) in context. |
| **Retrieval** | `context_utilization` | `retrievedChunks`, `generatedAnswer` | Citation & lexical usage (0.0–1.0) | Proportion of retrieved chunks actually reflected or cited in the answer. |
| **Retrieval** | `recall_at_k` | `retrievedChunks`, `referenceContextIds` | Set overlap (0.0–1.0) | Fraction of known relevant chunks retrieved within the top K results. |
| **Retrieval** | `mrr` | `retrievedChunks`, `referenceContextIds` | Reciprocal rank (0.0–1.0) | Reciprocal rank of the highest-ranked relevant chunk (1 / rank). |
| **Retrieval** | `ndcg_at_k` | `retrievedChunks`, `referenceContextIds` | Discounted cumulative gain (0.0–1.0) | Normalized DCG measuring ranking quality and relevance discount. |
| **Retrieval** | `context_relevance` | `question`, `retrievedChunks` | Rank-weighted token alignment (0.0–1.0) | Query-to-context semantic and lexical alignment, independent of answer. |
| **Retrieval** | `noise_sensitivity` | `cleanResult`, `noisyResult` | Controlled Jaccard divergence (0.0–1.0) | Measure of answer degradation when irrelevant/distracting context is added. |
| **Generation** | `faithfulness` | `generatedAnswer`, `retrievedChunks` | Claim verification (0.0–1.0) | Proportion of factual claims in answer strictly supported by retrieved context. |
| **Generation** | `response_groundedness` | `generatedAnswer`, `retrievedChunks` | Lexical grounding density (0.0–1.0) | Overall text grounding density across the entire response. |
| **Generation** | `answer_relevancy` | `question`, `generatedAnswer` | Term coverage (0.0–1.0) | Alignment with original query without penalizing concise responses. |
| **Generation** | `factual_correctness` | `generatedAnswer`, `referenceAnswer`, `expectedValues` | Claim & value audit (0.0–1.0) | Statement and key financial value agreement against trusted reference. |
| **Generation** | `citation_correctness` | `generatedAnswer`, `citations`, `retrievedChunks` | Citation validity & support (0.0–1.0) | Verifies real source IDs (`[Source X]`) and confirms cited passage supports claim. |
| **Generation** | `answer_completeness` | `generatedAnswer`, `expectedEntities`, `expectedValues` | Itemized coverage (0.0–1.0) | Assesses whether all required entities, values, and caveats are answered. |
| **Generation** | `answer_accuracy` | `generatedAnswer`, `referenceAnswer` | Token F1 agreement (0.0–1.0) | Harmonic mean of precision and recall against trusted reference. |
| **Financial** | `numerical_accuracy` | `generatedAnswer`, `expectedFinancialValues` | Deterministic scale parser (0.0–1.0) | Parses monetary scales, percentages, accounting parens with explicit tolerance. |
| **Financial** | `financial_entity_accuracy` | `generatedAnswer`, `expectedEntities`, `period`, `currency` | Entity matcher & synonyms (0.0–1.0) | Validates tickers, periods, and currency symbols (`$` for `USD`, `€` for `EUR`). |
| **Financial** | `abstention_accuracy` | `result`, `expectedBehavior` | Behavioral refusal check (0.0 or 1.0) | Validates safe refusal on missing data; detects hallucinations & false refusals. |
| **Agentic** | `tool_call_accuracy` | `agentTrace`, `expectedIntent`, `expectedSymbol` | Trace audit (0.0–1.0) | Validates query intent classification, ticker extraction, and tool execution. |
| **Agentic** | `tool_call_f1` | `agentTrace`, `expectedTools` | Set F1 (0.0–1.0) | Precision and recall of executed orchestration pipeline stages. |
| **Agentic** | `bounded_iteration_accuracy` | `agentTrace`, `maxIterations` | Iteration boundary check (0.0 or 1.0) | Enforces iteration limits (<= 3) and timeout boundaries. |

---

### Root-Cause Failure Diagnosis (Section 7)

The evaluation runner classifies every sample failure into one of five root causes:
- **Case A: Retrieval Failure (`CASE_A_RETRIEVAL_FAILURE`)**: Relevant evidence was never retrieved or scored below the safety threshold.
- **Case B: Generation Failure (`CASE_B_GENERATION_FAILURE`)**: Relevant evidence was retrieved, but the generated answer contradicts it or introduced unsupported claims.
- **Case C: Context Error (`CASE_C_CONTEXT_ERROR`)**: The answer faithfully reflects the retrieved chunks, but the retrieved chunks contain outdated, conflicting, or incorrect figures compared to ground-truth reference.
- **Case D: Citation Failure (`CASE_D_CITATION_FAILURE`)**: Answer is factually consistent, but citations are fabricated, out-of-bounds, or misaligned with source passages.
- **Case E: Correct Limitation Acknowledgement (`CASE_E_CORRECT_ABSTENTION`)**: The question cannot be answered from available evidence, and the system correctly acknowledged the limitation without hallucinating (scored as a success).

---

### Evaluation Dataset & Provenance

The golden benchmark dataset is stored in `backend/data/evaluation_datasets/financial_rag_benchmark.json` and validated via Zod schema (`backend/src/evaluation/dataset/datasetSchema.js`).

Every record contains:
- `id`: Unique identifier (e.g., `FIN-EVAL-001`).
- `question`: Natural language financial query.
- `symbol` & `filing_type`: Ticker and SEC statutory document type.
- `reference_answer`: Manually verified ground-truth answer.
- `reference_contexts` & `reference_context_ids`: Expected chunk IDs.
- `reference_entities`: Key tickers, metrics, periods.
- `expected_financial_values`: Exact figures (`$39,296 million`, `46.3%`).
- `expected_behavior`: `'ANSWER'` | `'REFUSE'` | `'SECURITY_ISOLATION'`.
- `provenance`: Origin document, auditing team, and verification status (`VERIFIED_AUTHENTIC` | `PROVISIONAL` | `SYNTHETIC_CONTROL`).

---

### Quality Thresholds & Baseline Comparison

Configurable quality thresholds enforce minimum standards:
```javascript
export const DEFAULT_THRESHOLDS = {
  faithfulness: 0.75,
  context_precision: 0.70,
  context_recall: 0.70,
  answer_relevancy: 0.65,
  factual_correctness: 0.75,
  citation_correctness: 0.80,
  numerical_accuracy: 1.00,        // Strict 100% financial number correctness
  financial_entity_accuracy: 0.85,
  abstention_accuracy: 1.00,        // Zero hallucinations on unanswerable queries
};
```

When `--baseline <path>` is supplied, the runner automatically computes regression deltas and reports:
- **Improved metrics** ($\Delta > +0.02$)
- **Regressed metrics** ($\Delta < -0.02$)
- **Unchanged metrics**
- **Sample-level status regressions** (passed in baseline, failed in new run)

---

### Operational Commands

```bash
# 1. Run all automated unit and integration tests (139 tests across 7 suites)
npm test --prefix backend

# 2. Run the Financial RAG Evaluation Benchmark CLI
npm run rag:eval --prefix backend

# 3. Run evaluation with custom top-K and verbose output
node backend/scripts/evaluateRAG.js --topK 4 --verbose

# 4. Compare current run against a previous baseline report
node backend/scripts/evaluateRAG.js --baseline ./data/evaluation_reports/baseline.json

# 5. Ingest and vectorize all PDF filings in data/financial_documents/
npm run rag:ingest --prefix backend

# 6. Interactive CLI queries with citation verification
npm run rag:test --prefix backend
```

### REST API Evaluation Endpoint (Admin-Only)

```http
POST /api/v1/ai/rag/evaluate HTTP/1.1
Host: localhost:4000
Content-Type: application/json
Authorization: Bearer <ADMIN_JWT_TOKEN>

{
  "topK": 4
}
```

Response:
```json
{
  "success": true,
  "data": {
    "runId": "eval-1792952704624",
    "timestamp": "2026-10-25T18:25:04.624Z",
    "summary": {
      "totalSamples": 8,
      "passedSamples": 8,
      "failedSamples": 0,
      "durationMs": 162,
      "overallThresholdsPassed": true
    },
    "thresholdResults": { "overallPassed": true, "checks": { ... } },
    "aggregateMetrics": { ... }
  }
}
```
