/**
 * Global_Fit_Ulttra - Comprehensive Evaluation System Unit Tests
 * 
 * Verifies every retrieval, generation, financial, agentic, and runner capability:
 * - Retrieval: Context Precision, Recall, Entities Recall, Utilization, Recall@K, MRR, nDCG@K, Relevance, Noise Sensitivity
 * - Generation: Faithfulness, Groundedness, Relevancy, Factual Correctness, Citation Validity/Support, Completeness, Accuracy
 * - Financial: Numerical Accuracy (values, currency, scale, percentages, accounting parens), Entity Accuracy, Abstention
 * - Agentic: Tool Call Accuracy, F1, Bounded Iterations, Latencies, Cache Acceleration
 * - Diagnostics: Cases A through E failure classification
 * - Runner: Aggregations, Thresholds, Baseline Comparison & Regressions, Zod Dataset Schema
 * 
 * @jest-environment node
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import {
  contextPrecision,
  contextRecall,
  contextEntitiesRecall,
  contextUtilization,
  recallAtK,
  mrr,
  ndcgAtK,
  contextRelevance,
  noiseSensitivity,
} from '../../src/evaluation/metrics/RetrievalMetrics.js';

import {
  faithfulness,
  responseGroundedness,
  answerRelevancy,
  factualCorrectness,
  citationCorrectness,
  answerCompleteness,
  answerAccuracy,
} from '../../src/evaluation/metrics/GenerationMetrics.js';

import {
  parseFinancialNumber,
  numericalAccuracy,
  financialEntityAccuracy,
  abstentionAccuracy,
  isRefusalResponse,
} from '../../src/evaluation/metrics/FinancialMetrics.js';

import {
  toolCallAccuracy,
  toolCallF1,
  boundedIterationAccuracy,
  operationalMetrics,
} from '../../src/evaluation/metrics/AgenticMetrics.js';

import { LLMJudge } from '../../src/evaluation/evaluators/LLMJudge.js';
import { MetricEvaluator } from '../../src/evaluation/evaluators/MetricEvaluator.js';
import { EvaluationRunner, DEFAULT_THRESHOLDS } from '../../src/evaluation/runner/EvaluationRunner.js';
import { validateEvaluationDataset, evaluationSampleSchema } from '../../src/evaluation/dataset/datasetSchema.js';

describe('Global_Fit_Ulttra - RAG Evaluation System', () => {

  // =========================================================================
  // 1. RETRIEVAL EVALUATION METRICS
  // =========================================================================
  describe('Retrieval Metrics Suite', () => {
    const mockChunks = [
      { id: 'chunk-1', content: 'Apple Q3 iPhone revenue was $39,296 million.' },
      { id: 'chunk-2', content: 'Apple Services reached record $24,213 million.' },
      { id: 'chunk-3', content: 'Unrelated corporate governance overview.' },
      { id: 'chunk-4', content: 'General legal disclaimer and safe harbor statement.' },
    ];

    describe('Context Precision', () => {
      it('should score 1.0 for perfect retrieval where relevant chunks are at top', () => {
        const res = contextPrecision({
          retrievedChunks: mockChunks,
          referenceContextIds: ['chunk-1', 'chunk-2'],
          topK: 2,
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
        expect(res.isDeterministic).toBe(true);
      });

      it('should penalize when irrelevant chunks are ranked above relevant chunks', () => {
        const permuted = [mockChunks[2], mockChunks[0], mockChunks[3], mockChunks[1]];
        const res = contextPrecision({
          retrievedChunks: permuted,
          referenceContextIds: ['chunk-1'],
          topK: 4,
        });
        // Relevant chunk at rank 2: precision@2 = 1/2 = 0.5
        expect(res.score).toBe(0.5);
        expect(res.status).toBe('failed');
      });

      it('should return not_applicable without fabricating score when references are missing', () => {
        const res = contextPrecision({
          retrievedChunks: mockChunks,
          referenceContextIds: [],
        });
        expect(res.score).toBeNull();
        expect(res.status).toBe('not_applicable');
      });

      it('should score 0.0 when none of the retrieved chunks match reference IDs', () => {
        const res = contextPrecision({
          retrievedChunks: mockChunks,
          referenceContextIds: ['chunk-999'],
          topK: 4,
        });
        expect(res.score).toBe(0.0);
        expect(res.status).toBe('failed');
      });
    });

    describe('Context Recall', () => {
      it('should score 1.0 when retrieved context contains all reference claims', () => {
        const res = contextRecall({
          retrievedChunks: mockChunks,
          referenceAnswer: 'iPhone revenue was $39,296 million. Services was $24,213 million.',
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
      });

      it('should identify missing evidence and score proportionally', () => {
        const res = contextRecall({
          retrievedChunks: [mockChunks[0]], // only iPhone
          referenceAnswer: 'iPhone revenue was $39,296 million. Services reached $24,213 million with strong cloud growth.',
        });
        expect(res.score).toBeLessThan(1.0);
        expect(res.details.missingCount).toBeGreaterThan(0);
      });

      it('should handle missing reference answer by returning skipped', () => {
        const res = contextRecall({
          retrievedChunks: mockChunks,
          referenceAnswer: null,
        });
        expect(res.score).toBeNull();
        expect(res.status).toBe('skipped');
      });
    });

    describe('Context Entities Recall', () => {
      it('should detect required financial entities (tickers, metrics, values)', () => {
        const res = contextEntitiesRecall({
          retrievedChunks: mockChunks,
          referenceEntities: ['iPhone', '$39,296 million', 'Apple'],
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
      });

      it('should report missing entities accurately', () => {
        const res = contextEntitiesRecall({
          retrievedChunks: mockChunks,
          referenceEntities: ['iPhone', 'Vision Pro', 'Automotive Division'],
        });
        expect(res.score).toBeCloseTo(0.333, 2);
        expect(res.details.missing).toContain('Vision Pro');
      });

      it('should return not_applicable for negative/refusal tests', () => {
        const res = contextEntitiesRecall({
          retrievedChunks: [],
          referenceEntities: ['Tesla', 'commercial aircraft'],
          expectedBehavior: 'REFUSE',
        });
        expect(res.score).toBeNull();
        expect(res.status).toBe('not_applicable');
      });
    });

    describe('Context Utilization', () => {
      it('should score 1.0 when all retrieved chunks are cited or utilized', () => {
        const res = contextUtilization({
          retrievedChunks: mockChunks.slice(0, 2),
          generatedAnswer: '[Source 1] states iPhone sales were $39,296 million, while [Source 2] highlights record Services.',
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
      });

      it('should score lower when half the retrieved chunks are ignored in answer', () => {
        const res = contextUtilization({
          retrievedChunks: mockChunks,
          generatedAnswer: '[Source 1] iPhone revenue was $39,296 million.',
        });
        expect(res.score).toBeLessThan(0.7);
      });
    });

    describe('Recall@K, MRR, and nDCG@K', () => {
      it('should compute Recall@K correctly for top-1 and top-4', () => {
        const r1 = recallAtK({
          retrievedChunks: mockChunks,
          referenceContextIds: ['chunk-1', 'chunk-2'],
          k: 1,
        });
        expect(r1.score).toBe(0.5);

        const r4 = recallAtK({
          retrievedChunks: mockChunks,
          referenceContextIds: ['chunk-1', 'chunk-2'],
          k: 4,
        });
        expect(r4.score).toBe(1.0);
      });

      it('should calculate MRR as 1.0 when rank 1 is relevant, 0.5 when rank 2 is relevant', () => {
        const mrr1 = mrr({
          retrievedChunks: mockChunks,
          referenceContextIds: ['chunk-1'],
        });
        expect(mrr1.score).toBe(1.0);

        const mrr2 = mrr({
          retrievedChunks: [mockChunks[2], mockChunks[0]],
          referenceContextIds: ['chunk-1'],
        });
        expect(mrr2.score).toBe(0.5);
      });

      it('should compute nDCG@K with ideal and discounted ranking', () => {
        const res = ndcgAtK({
          retrievedChunks: mockChunks,
          referenceContextIds: ['chunk-1', 'chunk-2'],
          k: 4,
        });
        expect(res.score).toBe(1.0);
      });
    });

    describe('Context Relevance and Noise Sensitivity', () => {
      it('should compute rank-weighted context relevance', () => {
        const res = contextRelevance({
          question: "What was Apple's iPhone revenue in Q3 2024?",
          retrievedChunks: mockChunks,
        });
        expect(res.score).toBeGreaterThan(0.35);
        expect(res.status).toBe('passed');
      });

      it('should measure noise sensitivity between clean and distracted contexts', () => {
        const clean = { answer: 'Apple iPhone net sales were $39,296 million.' };
        const noisy = { answer: 'Apple iPhone net sales were $39,296 million.' };
        const degraded = { answer: 'General corporate guidance and forward-looking risks apply.' };

        const stable = noiseSensitivity({ cleanResult: clean, noisyResult: noisy });
        expect(stable.score).toBe(0.0);
        expect(stable.status).toBe('passed');

        const disrupted = noiseSensitivity({ cleanResult: clean, noisyResult: degraded });
        expect(disrupted.score).toBeGreaterThan(0.5);
        expect(disrupted.status).toBe('failed');
      });
    });
  });

  // =========================================================================
  // 2. GENERATION EVALUATION METRICS
  // =========================================================================
  describe('Generation Metrics Suite', () => {
    const mockRetrieved = [
      { id: 'c1', content: 'Apple Q3 iPhone sales were $39,296 million, down 1%. Total net sales were $85,777 million.' }
    ];

    describe('Faithfulness', () => {
      it('should score 1.0 when all factual claims are supported by context', async () => {
        const res = await faithfulness({
          generatedAnswer: 'Apple reported iPhone sales of $39,296 million and total net sales of $85,777 million.',
          retrievedChunks: mockRetrieved,
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
      });

      it('should penalize unsupported hallucinated claims', async () => {
        const res = await faithfulness({
          generatedAnswer: 'Apple reported iPhone sales of $39,296 million. Apple acquired a space exploration startup for $100 billion.',
          retrievedChunks: mockRetrieved,
        });
        expect(res.score).toBeLessThan(0.7);
        expect(res.details.unsupportedCount).toBeGreaterThan(0);
      });

      it('should pass with 1.0 on safe refusal responses', async () => {
        const res = await faithfulness({
          generatedAnswer: 'The provided financial documents do not contain sufficient evidence to answer this question.',
          retrievedChunks: [],
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
      });
    });

    describe('Response Groundedness', () => {
      it('should evaluate lexical and contextual grounding density', () => {
        const res = responseGroundedness({
          generatedAnswer: 'iPhone sales reached $39,296 million with total net sales of $85,777 million.',
          retrievedChunks: mockRetrieved,
        });
        expect(res.score).toBeGreaterThan(0.7);
        expect(res.status).toBe('passed');
      });
    });

    describe('Answer Relevancy', () => {
      it('should evaluate whether the answer addresses the question', async () => {
        const res = await answerRelevancy({
          question: "What were Apple's iPhone sales in Q3?",
          generatedAnswer: 'iPhone sales were $39,296 million in Q3.',
        });
        expect(res.score).toBeGreaterThan(0.7);
        expect(res.status).toBe('passed');
      });

      it('should award 1.0 when refusal directly addresses unanswerable query', async () => {
        const res = await answerRelevancy({
          question: 'What was Tesla commercial airplane revenue?',
          generatedAnswer: 'No matching financial filings found in repository.',
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
      });
    });

    describe('Factual Correctness', () => {
      it('should score high factual correctness when key values and statements align', () => {
        const res = factualCorrectness({
          generatedAnswer: 'Apple net sales were $85,777 million and iPhone was $39,296 million.',
          referenceAnswer: 'Total sales were $85,777 million with iPhone sales of $39,296 million.',
          expectedValues: ['$85,777 million', '$39,296 million'],
        });
        expect(res.score).toBeGreaterThanOrEqual(0.90);
        expect(res.status).toBe('passed');
      });

      it('should return skipped when reference answer is unavailable', () => {
        const res = factualCorrectness({
          generatedAnswer: 'Some answer',
          referenceAnswer: null,
          expectedValues: [],
        });
        expect(res.score).toBeNull();
        expect(res.status).toBe('skipped');
      });
    });

    describe('Citation Correctness', () => {
      it('should verify valid [Source 1] pointing to existing chunk', () => {
        const res = citationCorrectness({
          generatedAnswer: 'iPhone revenue was $39,296 million [Source 1].',
          citations: [{ sourceId: 1 }],
          retrievedChunks: mockRetrieved,
        });
        expect(res.score).toBeGreaterThanOrEqual(0.8);
        expect(res.status).toBe('passed');
      });

      it('should support labeled citations like [Source 1: AAPL 10-Q]', () => {
        const res = citationCorrectness({
          generatedAnswer: 'iPhone revenue was $39,296 million [Source 1: AAPL 10-Q].',
          citations: [{ sourceId: 1 }],
          retrievedChunks: mockRetrieved,
        });
        expect(res.score).toBeGreaterThanOrEqual(0.8);
        expect(res.details.validCount).toBe(1);
      });

      it('should fail when citation is fabricated or out of bounds [Source 99]', () => {
        const res = citationCorrectness({
          generatedAnswer: 'Revenue was high [Source 99].',
          citations: [],
          retrievedChunks: mockRetrieved, // only 1 chunk exists
        });
        expect(res.details.invalidCount).toBe(1);
        expect(res.score).toBeLessThan(0.5);
      });

      it('should pass with 1.0 when safe refusal requires zero citations', () => {
        const res = citationCorrectness({
          generatedAnswer: 'No matching financial filings found in repository.',
          citations: [],
          retrievedChunks: [],
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
      });
    });

    describe('Answer Completeness and Accuracy', () => {
      it('should verify coverage of expected items', () => {
        const res = answerCompleteness({
          generatedAnswer: 'Apple reported iPhone revenue of $39,296 million in Q3 2024.',
          expectedEntities: ['Apple', 'iPhone', 'Q3 2024'],
          expectedValues: ['$39,296 million'],
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
      });

      it('should compute token F1 accuracy against reference', () => {
        const res = answerAccuracy({
          generatedAnswer: 'Apple iPhone net sales were $39,296 million.',
          referenceAnswer: 'Apple reported iPhone net sales of $39,296 million.',
        });
        expect(res.score).toBeGreaterThan(0.85);
        expect(res.status).toBe('passed');
      });
    });
  });

  // =========================================================================
  // 3. FINANCIAL SPECIFIC CORRECTNESS METRICS
  // =========================================================================
  describe('Financial Specific Metrics Suite', () => {
    describe('parseFinancialNumber', () => {
      it('should parse monetary scales (millions, billions, thousands)', () => {
        expect(parseFinancialNumber('$39,296 million').value).toBe(39296000000);
        expect(parseFinancialNumber('$245.1 billion').value).toBe(245100000000);
        expect(parseFinancialNumber('$500 thousand').value).toBe(500000);
      });

      it('should parse negative accounting notation and signs', () => {
        const paren = parseFinancialNumber('(1%)');
        expect(paren.value).toBe(-1);
        expect(paren.isPercentage).toBe(true);

        const minus = parseFinancialNumber('-5.5%');
        expect(minus.value).toBe(-5.5);
        expect(minus.isPercentage).toBe(true);
      });
    });

    describe('Numerical Accuracy', () => {
      it('should deterministically verify exact financial figures', () => {
        const res = numericalAccuracy({
          generatedAnswer: 'Apple iPhone sales were $39,296 million and Services was $24,213 million (up 14%). Gross margin was 46.3%.',
          expectedFinancialValues: ['$39,296 million', '$24,213 million', '14%', '46.3%'],
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
      });

      it('should match rounded financial figures within explicit tolerance (85.78B vs 85,777M)', () => {
        const res = numericalAccuracy({
          generatedAnswer: 'Apple total net sales were $85.78 billion.',
          expectedFinancialValues: ['$85,777 million'], // 85,777,000,000 vs 85,780,000,000 (~0.003% diff)
          tolerance: 0.015,
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
      });

      it('should strictly fail when wrong orders of magnitude or wrong numbers are given', () => {
        const res = numericalAccuracy({
          generatedAnswer: 'Apple iPhone sales were $39,296 thousand.', // wrong scale!
          expectedFinancialValues: ['$39,296 million'],
        });
        expect(res.score).toBe(0.0);
        expect(res.status).toBe('failed');
      });
    });

    describe('Financial Entity Accuracy', () => {
      it('should verify entities and handle currency synonyms ($ for USD)', () => {
        const res = financialEntityAccuracy({
          generatedAnswer: 'Apple Inc. reported $39,296 million for Q3 2024.',
          expectedEntities: ['Apple Inc.', 'Q3 2024'],
          expectedCurrency: 'USD',
          expectedReportingPeriod: 'Q3 2024',
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
      });

      it('should return not_applicable for negative/abstention cases', () => {
        const res = financialEntityAccuracy({
          generatedAnswer: 'No matching financial filings found.',
          expectedEntities: ['Tesla', 'commercial aircraft'],
          expectedBehavior: 'REFUSE',
        });
        expect(res.score).toBeNull();
        expect(res.status).toBe('not_applicable');
      });
    });

    describe('Abstention and Insufficient-Evidence Accuracy', () => {
      it('should pass when system correctly refuses on missing data', () => {
        const res = abstentionAccuracy({
          result: { answer: 'No matching financial filings found in repository', retrievalCount: 0, confidence: 0 },
          expectedBehavior: 'REFUSE',
        });
        expect(res.score).toBe(1.0);
        expect(res.status).toBe('passed');
      });

      it('should fail when system attempts to answer when refusal was required (hallucination)', () => {
        const res = abstentionAccuracy({
          result: { answer: 'Tesla aircraft division generated $5 billion in revenue', retrievalCount: 1, confidence: 90 },
          expectedBehavior: 'REFUSE',
        });
        expect(res.score).toBe(0.0);
        expect(res.status).toBe('failed');
      });

      it('should fail on False Refusal when evidence was present but system refused', () => {
        const res = abstentionAccuracy({
          result: { answer: 'The provided financial documents do not contain sufficient evidence', retrievalCount: 0 },
          expectedBehavior: 'ANSWER',
        });
        expect(res.score).toBe(0.0);
        expect(res.status).toBe('failed');
      });
    });
  });

  // =========================================================================
  // 4. AGENTIC WORKFLOW & OPERATIONAL METRICS
  // =========================================================================
  describe('Agentic Workflow & Operational Metrics Suite', () => {
    const mockTrace = [
      { stage: 'CLASSIFICATION', result: { intent: 'DOCUMENT_QA', symbols: ['AAPL'], primarySymbol: 'AAPL' } },
      { stage: 'PLANNING', subQueries: ['Apple iPhone revenue'] },
      { stage: 'ITERATION_EVALUATION', iteration: 1, sufficiency: { isSufficient: true } },
      { stage: 'SYNTHESIS' },
      { stage: 'CITATION_VALIDATION', citationsCount: 1 },
    ];

    it('should evaluate routing accuracy and ticker extraction', () => {
      const res = toolCallAccuracy({
        agentTrace: mockTrace,
        expectedIntent: 'DOCUMENT_QA',
        expectedSymbol: 'AAPL',
        expectedTools: ['CLASSIFICATION', 'PLANNING', 'SYNTHESIS'],
      });
      expect(res.score).toBe(1.0);
      expect(res.status).toBe('passed');
    });

    it('should calculate tool call F1 score', () => {
      const res = toolCallF1({
        agentTrace: mockTrace,
        expectedTools: ['CLASSIFICATION', 'PLANNING', 'SYNTHESIS'],
      });
      expect(res.score).toBeGreaterThanOrEqual(0.75);
      expect(res.status).toBe('passed');
    });

    it('should verify bounded iterations under max limit', () => {
      const res = boundedIterationAccuracy({
        agentTrace: mockTrace,
        maxIterations: 3,
      });
      expect(res.score).toBe(1.0);
      expect(res.status).toBe('passed');
    });

    it('should record operational latencies and cache speedup', () => {
      const ops = operationalMetrics({
        result: { latencyMs: 18, cached: true, retrievalCount: 2, confidence: 98 },
        startTime: Date.now() - 18,
      });
      expect(ops.latency.totalMs).toBe(18);
      expect(ops.latency.cached).toBe(true);
      expect(ops.latency.speedup).toContain('Semantic Cache Hit');
    });
  });

  // =========================================================================
  // 5. EVALUATION RUNNER, DATASET & FAILURE DIAGNOSTICS
  // =========================================================================
  describe('Evaluation Runner & Failure Diagnostics Suite', () => {
    it('should validate dataset schema with Zod', () => {
      const validSample = {
        id: 'TEST-001',
        question: 'What was revenue?',
        symbol: 'AAPL',
        reference_answer: 'Revenue was $10B.',
        expected_behavior: 'ANSWER',
        tags: ['test'],
        provenance: {
          sourceDocument: 'test.pdf',
          verifiedBy: 'tester',
          verificationStatus: 'VERIFIED_AUTHENTIC',
        },
      };

      const parseResult = evaluationSampleSchema.safeParse(validSample);
      expect(parseResult.success).toBe(true);

      const invalidSample = { id: '', question: 'Hi' };
      const invalidResult = evaluationSampleSchema.safeParse(invalidSample);
      expect(invalidResult.success).toBe(false);
    });

    it('should diagnose Case E Correct Abstention properly', () => {
      const evaluator = new MetricEvaluator();
      const diag = evaluator.diagnoseFailureMode({
        sample: { expected_behavior: 'REFUSE' },
        metrics: { abstention_accuracy: { status: 'passed' } },
        result: { answer: 'No matching financial filings found in repository' },
        retrievedChunks: [],
      });
      expect(diag.classification).toBe('CASE_E_CORRECT_ABSTENTION');
      expect(diag.severity).toBe('NONE');
    });

    it('should diagnose Case A Retrieval Failure when recall is below 0.40', () => {
      const evaluator = new MetricEvaluator();
      const diag = evaluator.diagnoseFailureMode({
        sample: { expected_behavior: 'ANSWER' },
        metrics: {
          context_recall: { score: 0.1 },
          abstention_accuracy: { status: 'failed' },
        },
        result: { answer: 'Some answer' },
        retrievedChunks: [],
      });
      expect(diag.classification).toBe('CASE_A_RETRIEVAL_FAILURE');
      expect(diag.severity).toBe('HIGH');
    });

    it('should compare runs against a baseline and report regressions and improvements', () => {
      const runner = new EvaluationRunner();
      const currentAggregates = {
        faithfulness: { mean: 0.90 },
        context_recall: { mean: 0.70 },
      };
      const baselineAggregates = {
        faithfulness: { mean: 0.80 }, // improved +0.10
        context_recall: { mean: 0.85 }, // regressed -0.15
      };

      const comparison = runner.compareWithBaseline(currentAggregates, baselineAggregates);
      expect(comparison.hasRegressions).toBe(true);
      expect(comparison.improved[0].metric).toBe('faithfulness');
      expect(comparison.regressed[0].metric).toBe('context_recall');
    });

    it('should run LLM Judge in mock mode with zero paid API calls', async () => {
      const mockJudge = new LLMJudge({ enabled: true, provider: 'mock' });
      const res = await mockJudge.evaluateEntailment({
        context: 'Apple revenue was $85 billion in 2024.',
        claims: ['Apple revenue was $85 billion'],
      });
      expect(res.score).toBe(1.0);
      expect(mockJudge.getUsageReport().callCount).toBe(1);
      expect(mockJudge.getUsageReport().estimatedTotalCostUsd).toBe(0.0);
    });
  });
});
