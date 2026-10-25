/**
 * Global_Fit_Ulttra - Production Financial RAG Evaluation Benchmark CLI
 * 
 * Comprehensive automated benchmark evaluating:
 * 1. Retrieval Metrics: Context Precision@K, Context Recall, Context Entities Recall, Context Utilization, Recall@K, MRR, nDCG@K, Context Relevance
 * 2. Generation Metrics: Faithfulness, Response Groundedness, Answer Relevancy, Factual Correctness, Citation Correctness, Answer Completeness, Answer Accuracy
 * 3. Financial Correctness: Numerical Accuracy (values, currency, scale, percentages, accounting notation), Financial Entity Accuracy, Insufficient-Evidence Abstention
 * 4. Agentic Workflow & Operations: Tool Call Accuracy, Tool Call F1, Bounded Iterations, Latency breakdowns, Cache Acceleration
 * 
 * Usage:
 *   npm run rag:eval
 *   node scripts/evaluateRAG.js --topK 4 --verbose
 *   node scripts/evaluateRAG.js --baseline ./data/evaluation_reports/baseline.json
 * 
 * @module scripts/evaluateRAG
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { program } from 'commander';
import { EmbeddingClient } from '../src/infrastructure/ai/EmbeddingClient.js';
import { VectorStore } from '../src/infrastructure/vector/VectorStore.js';
import { RerankerClient } from '../src/infrastructure/ai/RerankerClient.js';
import { SemanticCache } from '../src/infrastructure/cache/SemanticCache.js';
import { RAGService } from '../src/services/RAGService.js';
import { EvaluationRunner, DEFAULT_THRESHOLDS } from '../src/evaluation/runner/EvaluationRunner.js';
import { loadEvaluationDataset } from '../src/evaluation/dataset/seedDataset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Authentic corpus chunks corresponding to repository PDF filings
const BENCHMARK_CHUNKS = [
  {
    _id: 'chunk-aapl-1',
    documentId: 'doc-aapl',
    content: 'Apple Inc. Form 10-Q Q3 2024. Revenue by Product Category: iPhone net sales were $39,296 million (down 1%). Services reached an all-time record of $24,213 million (up 14%). Total net sales were $85,777 million with gross margin of 46.3%.',
    metadata: { symbol: 'AAPL', filingType: '10-Q', section: 'Statements of Operations', pageNumber: 1, isPublic: true },
    embedding: null,
  },
  {
    _id: 'chunk-aapl-2',
    documentId: 'doc-aapl',
    content: 'Apple Inc. Item 1A: Risk Factors. The Company faces regulatory scrutiny under the European Union Digital Markets Act (DMA), requiring changes to the App Store business model and commission structures.',
    metadata: { symbol: 'AAPL', filingType: '10-Q', section: 'Item 1A: Risk Factors', pageNumber: 4, isPublic: true },
    embedding: null,
  },
  {
    _id: 'chunk-msft-1',
    documentId: 'doc-msft',
    content: 'Microsoft Corp. Form 10-K FY2024. Consolidated revenue was $245.1 billion, up 16%. Intelligent Cloud revenue was $105.4 billion. Azure and other cloud services revenue grew 30%, with 8 points from AI services.',
    metadata: { symbol: 'MSFT', filingType: '10-K', section: 'Item 7: MD&A', pageNumber: 2, isPublic: true },
    embedding: null,
  },
  {
    _id: 'chunk-nvda-1',
    documentId: 'doc-nvda',
    content: 'NVIDIA Corporation Form 10-K FY2024. Compute & Networking Data Center platform revenue reached $47,405 million, up 217% year-over-year. GAAP gross margin was 72.7%, driven by strong HGX Hopper architecture demand.',
    metadata: { symbol: 'NVDA', filingType: '10-K', section: 'Executive Highlights', pageNumber: 1, isPublic: true },
    embedding: null,
  },
  {
    _id: 'chunk-fed-1',
    documentId: 'doc-fed',
    content: 'Federal Reserve Federal Open Market Committee (FOMC) Statement. The Committee decided to maintain the target range for the federal funds rate at 5.25 to 5.50 percent. Inflation has eased over the past year but remains elevated toward the 2 percent objective.',
    metadata: { symbol: 'FED', filingType: 'FOMC', section: 'Monetary Policy Decision', pageNumber: 1, isPublic: true },
    embedding: null,
  },
  {
    _id: 'chunk-tenant-private',
    documentId: 'doc-private',
    content: 'Acme Financial Internal Research Note: Restricted to Organization Org-Alpha. Proprietary target valuation estimate of $250/share.',
    metadata: { symbol: 'ACME', filingType: 'REPORT', section: 'Confidential Valuation', pageNumber: 1, isPublic: false, organizationId: 'org-alpha' },
    embedding: null,
  },
];

async function main() {
  program
    .option('--dataset <path>', 'Path to custom evaluation dataset JSON')
    .option('--topK <number>', 'Cutoff rank for retrieval evaluation', '4')
    .option('--baseline <path>', 'Path to baseline evaluation JSON for regression testing')
    .option('--output <path>', 'Path to write evaluation results JSON', path.resolve(__dirname, '..', 'data', 'evaluation_reports', `eval-${Date.now()}.json`))
    .option('--verbose', 'Print verbose step-by-step progress', false)
    .parse(process.argv);

  const options = program.opts();
  const topK = parseInt(options.topK, 10) || 4;

  console.log('=================================================================================');
  console.log('Global_Fit_Ulttra — Production Financial Agentic RAG Evaluation Benchmark');
  console.log('=================================================================================\n');

  // 1. Initialize local embedding client
  const embeddingClient = new EmbeddingClient({ provider: 'local' });
  console.log('Indexing semantic vector embeddings for benchmark corpus...');
  const contents = BENCHMARK_CHUNKS.map(c => c.content);
  const embeddings = await embeddingClient.embedBatch(contents);
  for (let i = 0; i < BENCHMARK_CHUNKS.length; i++) {
    BENCHMARK_CHUNKS[i].embedding = embeddings[i];
  }
  console.log(`✅ Indexed ${BENCHMARK_CHUNKS.length} test chunks with 384-dimensional unit vectors.\n`);

  // 2. Setup Vector Store with in-memory candidate filter
  const mockModel = {
    find: (filter) => ({
      select: () => ({
        lean: () => ({
          limit: async () => {
            return BENCHMARK_CHUNKS.filter(chunk => {
              if (filter['metadata.symbol'] && chunk.metadata.symbol !== filter['metadata.symbol']) return false;
              if (filter['metadata.filingType'] && chunk.metadata.filingType !== filter['metadata.filingType']) return false;
              if (filter['metadata.isPublic'] !== undefined && chunk.metadata.isPublic !== filter['metadata.isPublic']) return false;
              if (filter.$or) {
                const matchOrg = filter.$or.some(cond => {
                  if (cond['metadata.isPublic'] && chunk.metadata.isPublic) return true;
                  if (cond['metadata.organizationId'] && chunk.metadata.organizationId === cond['metadata.organizationId']) return true;
                  return false;
                });
                if (!matchOrg) return false;
              }
              return true;
            });
          }
        })
      })
    })
  };

  const vectorStore = new VectorStore({
    documentChunkModel: mockModel,
    qdrantVectorStore: null,
  });

  const rerankerClient = new RerankerClient();
  const semanticCache = new SemanticCache();

  const ragService = new RAGService({
    groqClient: null, // Deterministic offline verification path (zero paid API calls)
    embeddingClient,
    vectorStore,
    rerankerClient,
    semanticCache,
  });

  // 3. Load dataset
  const dataset = loadEvaluationDataset(options.dataset);
  console.log(`📋 Loaded Dataset: "${dataset.name}" (v${dataset.datasetVersion}) - ${dataset.samples.length} test samples\n`);

  // 4. Initialize Evaluation Runner
  const runner = new EvaluationRunner({
    ragService,
    topK,
    thresholds: DEFAULT_THRESHOLDS,
  });

  console.log('Running automated RAG benchmark across all metric suites...\n');
  const report = await runner.run({
    dataset,
    baselinePath: options.baseline,
    outputPath: options.output,
    verbose: options.verbose,
  });

  // 5. Render Metric Aggregate Scorecard
  console.log('---------------------------------------------------------------------------------------------------------');
  console.log('| Metric Category & Name              | Mean Score | Coverage | Status   | Method & Details             |');
  console.log('---------------------------------------------------------------------------------------------------------');

  const orderedDisplay = [
    // Retrieval Suite
    { name: 'context_precision', label: 'Context Precision@4' },
    { name: 'context_recall', label: 'Context Recall' },
    { name: 'context_entities_recall', label: 'Context Entities Recall' },
    { name: 'context_utilization', label: 'Context Utilization' },
    { name: `recall_at_${topK}`, label: `Recall@${topK}` },
    { name: 'mrr', label: 'Mean Reciprocal Rank (MRR)' },
    { name: `ndcg_at_${topK}`, label: `nDCG@${topK}` },
    { name: 'context_relevance', label: 'Context Relevance' },
    // Generation Suite
    { name: 'faithfulness', label: 'Faithfulness' },
    { name: 'response_groundedness', label: 'Response Groundedness' },
    { name: 'answer_relevancy', label: 'Answer Relevancy' },
    { name: 'factual_correctness', label: 'Factual Correctness' },
    { name: 'citation_correctness', label: 'Citation Correctness' },
    { name: 'answer_completeness', label: 'Answer Completeness' },
    { name: 'answer_accuracy', label: 'Answer Accuracy / F1' },
    // Financial Specific Suite
    { name: 'numerical_accuracy', label: 'Numerical Accuracy (Financial)' },
    { name: 'financial_entity_accuracy', label: 'Financial Entity Accuracy' },
    { name: 'abstention_accuracy', label: 'Abstention / Anti-Hallucination' },
    // Agentic Suite
    { name: 'tool_call_accuracy', label: 'Tool Call & Routing Accuracy' },
    { name: 'bounded_iteration_accuracy', label: 'Bounded Iteration Safety' },
  ];

  for (const item of orderedDisplay) {
    const agg = report.aggregateMetrics[item.name];
    if (!agg) continue;

    const labelStr = item.label.padEnd(35);
    const scoreStr = agg.mean !== null ? `${(agg.mean * 100).toFixed(1)}%`.padEnd(10) : 'N/A       ';
    const covStr = `${(agg.coverage * 100).toFixed(0)}%`.padEnd(8);
    const passedCount = agg.statuses?.passed || 0;
    const failedCount = agg.statuses?.failed || 0;
    const statusStr = (failedCount === 0 && passedCount > 0 ? '✅ PASS' : (failedCount > 0 ? '❌ FAIL' : 'ℹ️ SKIP')).padEnd(8);
    const detailStr = `Passed: ${passedCount}, Failed: ${failedCount}, Skipped: ${agg.statuses?.skipped || 0}`;

    console.log(`| ${labelStr} | ${scoreStr} | ${covStr} | ${statusStr} | ${detailStr}`);
  }
  console.log('---------------------------------------------------------------------------------------------------------\n');

  // 6. Output Threshold Compliance Summary
  console.log('📊 Quality Thresholds Verification:');
  for (const [metric, check] of Object.entries(report.thresholdResults.checks)) {
    const statusIcon = check.status === 'PASSED' ? '✅' : (check.status === 'FAILED' ? '❌' : 'ℹ️');
    const scoreDisp = check.actual !== null ? `${(check.actual * 100).toFixed(1)}%` : 'N/A';
    console.log(`   ${statusIcon} ${metric}: ${scoreDisp} (Threshold: ${(check.threshold * 100).toFixed(0)}%) - ${check.reason}`);
  }

  // 7. Output Sample Diagnosis & Root Cause Classification
  console.log('\n🔬 Sample-Level Diagnosis Summary:');
  for (const s of report.sampleResults) {
    const statusIcon = s.status === 'passed' ? '✅' : '❌';
    console.log(`   ${statusIcon} [${s.sampleId}] ${s.question.slice(0, 48).padEnd(50)} -> ${s.failureDiagnosis.classification}`);
  }

  // 8. Regression Report
  if (report.regressionReport) {
    console.log('\n🔍 Baseline Comparison & Regression Report:');
    if (report.regressionReport.hasRegressions) {
      console.log('   ⚠️ REGRESSIONS DETECTED:');
      for (const reg of report.regressionReport.regressed) {
        console.log(`      - ${reg.metric}: ${reg.baselineScore} -> ${reg.currentScore} (Δ ${reg.delta})`);
      }
    } else {
      console.log('   ✅ No regressions detected compared to baseline run.');
    }
  }

  console.log(`\n💾 Detailed JSON evaluation report saved to: ${options.output}`);
  console.log(`⏱ Total Benchmark Duration: ${report.summary.durationMs}ms`);
  console.log('=================================================================================\n');

  if (report.summary.overallThresholdsPassed) {
    console.log('🎉 Financial Agentic RAG Evaluation Benchmark PASSED all quality thresholds!');
    process.exit(0);
  } else {
    console.error('❌ Benchmark failed to meet all required quality thresholds.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal evaluation benchmark error:', err);
  process.exit(1);
});
