/**
 * Global_Fit_Ulttra - Comprehensive Sample Metric Evaluator
 * 
 * Orchestrates running all applicable retrieval, generation, financial, and agentic metrics
 * on a single evaluation sample, and classifies the root cause failure mode:
 * - Case A: Retrieval failure (relevant evidence was never retrieved)
 * - Case B: Generation failure (relevant evidence retrieved, but answer contradicts it)
 * - Case C: Context factual error (answer faithful to context, but context conflicts with ground-truth reference)
 * - Case D: Citation error (answer is factually correct, but citation is invalid or fabricated)
 * - Case E: Correct limitation acknowledgement (safe refusal on unanswerable query - not a failure)
 * 
 * @module evaluation/evaluators/MetricEvaluator
 */

import {
  contextPrecision,
  contextRecall,
  contextEntitiesRecall,
  contextUtilization,
  recallAtK,
  mrr,
  ndcgAtK,
  contextRelevance,
} from '../metrics/RetrievalMetrics.js';

import {
  faithfulness,
  responseGroundedness,
  answerRelevancy,
  factualCorrectness,
  citationCorrectness,
  answerCompleteness,
  answerAccuracy,
} from '../metrics/GenerationMetrics.js';

import {
  numericalAccuracy,
  financialEntityAccuracy,
  abstentionAccuracy,
} from '../metrics/FinancialMetrics.js';

import {
  toolCallAccuracy,
  toolCallF1,
  boundedIterationAccuracy,
  operationalMetrics,
} from '../metrics/AgenticMetrics.js';

export class MetricEvaluator {
  constructor({ llmJudge = null, defaultTopK = 4 } = {}) {
    this.llmJudge = llmJudge;
    this.defaultTopK = defaultTopK;
  }

  /**
   * Evaluates all applicable metrics for a single sample and its pipeline result.
   * 
   * @param {object} params
   * @param {object} params.sample - Test case definition from dataset
   * @param {object} params.result - Actual pipeline execution result
   * @param {number} [params.topK=4]
   * @returns {Promise<object>} Detailed sample evaluation result
   */
  async evaluateSample({ sample, result, topK = this.defaultTopK }) {
    const startTime = Date.now();
    const retrievedChunks = result.retrievedContexts || result.retrievedChunks || [];
    const generatedAnswer = result.answer || '';
    const citations = result.citations || [];
    const agentTrace = result.agentTrace || [];

    const metrics = {};

    // 1. Retrieval Metrics
    metrics.context_precision = contextPrecision({
      retrievedChunks,
      referenceContextIds: sample.reference_context_ids,
      referenceContexts: sample.reference_contexts,
      topK,
    });

    metrics.context_recall = contextRecall({
      retrievedChunks,
      referenceAnswer: sample.reference_answer,
      referenceClaims: sample.reference_claims,
      referenceContexts: sample.reference_contexts,
    });

    metrics.context_entities_recall = contextEntitiesRecall({
      retrievedChunks,
      referenceEntities: sample.reference_entities,
      expectedBehavior: sample.expected_behavior || 'ANSWER',
    });

    metrics.context_utilization = contextUtilization({
      retrievedChunks,
      generatedAnswer,
    });

    metrics[`recall_at_${topK}`] = recallAtK({
      retrievedChunks,
      referenceContextIds: sample.reference_context_ids,
      k: topK,
    });

    metrics.mrr = mrr({
      retrievedChunks,
      referenceContextIds: sample.reference_context_ids,
    });

    metrics[`ndcg_at_${topK}`] = ndcgAtK({
      retrievedChunks,
      referenceContextIds: sample.reference_context_ids,
      relevanceScores: sample.relevance_scores,
      k: topK,
    });

    metrics.context_relevance = contextRelevance({
      question: sample.question,
      retrievedChunks,
    });

    // 2. Generation Metrics
    metrics.faithfulness = await faithfulness({
      generatedAnswer,
      retrievedChunks,
      llmJudge: this.llmJudge,
    });

    metrics.response_groundedness = responseGroundedness({
      generatedAnswer,
      retrievedChunks,
    });

    metrics.answer_relevancy = await answerRelevancy({
      question: sample.question,
      generatedAnswer,
      llmJudge: this.llmJudge,
    });

    metrics.factual_correctness = factualCorrectness({
      generatedAnswer,
      referenceAnswer: sample.reference_answer,
      expectedValues: sample.expected_financial_values,
    });

    metrics.citation_correctness = citationCorrectness({
      generatedAnswer,
      citations,
      retrievedChunks,
    });

    metrics.answer_completeness = answerCompleteness({
      generatedAnswer,
      referenceAnswer: sample.reference_answer,
      expectedEntities: sample.reference_entities,
      expectedValues: sample.expected_financial_values,
    });

    metrics.answer_accuracy = answerAccuracy({
      generatedAnswer,
      referenceAnswer: sample.reference_answer,
    });

    // 3. Financial Specific Metrics
    metrics.numerical_accuracy = numericalAccuracy({
      generatedAnswer,
      expectedFinancialValues: sample.expected_financial_values,
    });

    metrics.financial_entity_accuracy = financialEntityAccuracy({
      generatedAnswer,
      expectedEntities: sample.reference_entities,
      expectedReportingPeriod: sample.expected_reporting_period,
      expectedCurrency: sample.expected_currency,
      expectedBehavior: sample.expected_behavior || 'ANSWER',
    });

    metrics.abstention_accuracy = abstentionAccuracy({
      result,
      expectedBehavior: sample.expected_behavior || 'ANSWER',
    });

    // 4. Agentic & Operational Metrics
    metrics.tool_call_accuracy = toolCallAccuracy({
      agentTrace,
      expectedIntent: sample.expected_intent,
      expectedSymbol: sample.symbol,
      expectedTools: sample.expected_tools,
    });

    metrics.tool_call_f1 = toolCallF1({
      agentTrace,
      expectedTools: sample.expected_tools,
    });

    metrics.bounded_iteration_accuracy = boundedIterationAccuracy({
      agentTrace,
      maxIterations: 3,
    });

    const operational = operationalMetrics({
      result,
      startTime,
    });

    // 5. Failure Mode Diagnosis (Section 7)
    const failureDiagnosis = this.diagnoseFailureMode({
      sample,
      metrics,
      result,
      retrievedChunks,
    });

    // Determine overall sample pass status based on critical verification metrics
    const criticalMetrics = [
      'faithfulness',
      'factual_correctness',
      'numerical_accuracy',
      'citation_correctness',
      'abstention_accuracy',
    ];
    const criticalFailures = criticalMetrics.filter(m => metrics[m] && metrics[m].status === 'failed');
    const isSamplePassed = criticalFailures.length === 0;

    return {
      sampleId: sample.id,
      question: sample.question,
      symbol: sample.symbol,
      status: isSamplePassed ? 'passed' : 'failed',
      failureDiagnosis,
      metrics,
      operational,
      evaluationDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Root-cause failure diagnosis distinguishing Cases A through E.
   */
  diagnoseFailureMode({ sample, metrics, result, retrievedChunks }) {
    const isExpectedRefusal = sample.expected_behavior === 'REFUSE' || sample.expected_behavior === 'SECURITY_ISOLATION';

    // Case E: Safe limitation acknowledgement
    if (isExpectedRefusal && metrics.abstention_accuracy?.status === 'passed') {
      return {
        classification: 'CASE_E_CORRECT_ABSTENTION',
        severity: 'NONE',
        description: 'Question cannot be answered from available evidence, and the system correctly acknowledged the limitation without hallucinating.',
      };
    }

    if (isExpectedRefusal && metrics.abstention_accuracy?.status === 'failed') {
      return {
        classification: 'CASE_E_FAILED_ABSTENTION',
        severity: 'CRITICAL',
        description: 'Question required abstention/refusal, but the system attempted an answer (hallucination or cross-tenant leak).',
      };
    }

    // Check Case A: Retrieval Failure
    const retrievalRecall = metrics.context_recall?.score;
    const retrievalPrecision = metrics.context_precision?.score;
    if (retrievedChunks.length === 0 || (retrievalRecall !== null && retrievalRecall < 0.40)) {
      return {
        classification: 'CASE_A_RETRIEVAL_FAILURE',
        severity: 'HIGH',
        description: 'Relevant evidence was never retrieved or scored below threshold in vector/BM25 search.',
      };
    }

    // Check Case B: Generation / Evidence Use Failure
    const faithfulnessScore = metrics.faithfulness?.score;
    if (faithfulnessScore !== null && faithfulnessScore < 0.65) {
      return {
        classification: 'CASE_B_GENERATION_FAILURE',
        severity: 'HIGH',
        description: 'Relevant evidence was retrieved, but the generated answer contradicts the evidence or introduced unsupported claims.',
      };
    }

    // Check Case C: Context Error / Ground-Truth conflict
    const factualScore = metrics.factual_correctness?.score;
    if (faithfulnessScore >= 0.85 && factualScore !== null && factualScore < 0.50) {
      return {
        classification: 'CASE_C_CONTEXT_ERROR',
        severity: 'MEDIUM',
        description: 'The answer faithfully reflects the retrieved chunks, but the retrieved chunks contain outdated, conflicting, or incorrect figures.',
      };
    }

    // Check Case D: Citation Failure
    const citationScore = metrics.citation_correctness?.score;
    if (citationScore !== null && citationScore < 0.60) {
      return {
        classification: 'CASE_D_CITATION_FAILURE',
        severity: 'MEDIUM',
        description: 'Answer is factually consistent, but citations are fabricated, out-of-bounds, or misaligned with source passages.',
      };
    }

    return {
      classification: 'NORMAL_EXECUTION',
      severity: 'NONE',
      description: 'Pipeline executed within standard tolerances.',
    };
  }
}
