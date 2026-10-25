/**
 * Global_Fit_Ulttra - Evaluation Runner
 * 
 * Reusable execution engine for financial RAG benchmarks:
 * 1. Executes RAG pipeline across validated test datasets
 * 2. Runs all 18+ retrieval, generation, financial, and agentic metrics
 * 3. Aggregates scores (sample count, coverage, mean, median, min, max, distribution)
 * 4. Checks configurable quality thresholds
 * 5. Performs baseline comparison & regression analysis
 * 6. Emits machine-readable versioned evaluation reports (JSON) and CLI scorecards
 * 
 * @module evaluation/runner/EvaluationRunner
 */

import fs from 'fs';
import path from 'path';
import { MetricEvaluator } from '../evaluators/MetricEvaluator.js';
import { LLMJudge } from '../evaluators/LLMJudge.js';
import { loadEvaluationDataset } from '../dataset/seedDataset.js';

export const DEFAULT_THRESHOLDS = {
  faithfulness: 0.75,
  context_precision: 0.70,
  context_recall: 0.70,
  answer_relevancy: 0.65,
  factual_correctness: 0.75,
  citation_correctness: 0.80,
  numerical_accuracy: 1.00, // Strict: 100% of financial numbers must be correct
  financial_entity_accuracy: 0.85,
  abstention_accuracy: 1.00, // Strict: zero hallucinations on unanswerable queries
};

export class EvaluationRunner {
  constructor({
    ragService = null,
    llmJudge = null,
    topK = 4,
    thresholds = DEFAULT_THRESHOLDS,
    evaluator = null,
  } = {}) {
    this.ragService = ragService;
    this.topK = topK;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.llmJudge = llmJudge || new LLMJudge({ enabled: false });
    this.evaluator = evaluator || new MetricEvaluator({
      llmJudge: this.llmJudge,
      defaultTopK: this.topK,
    });
  }

  /**
   * Runs the complete evaluation on a dataset.
   * 
   * @param {object} params
   * @param {string|object} [params.dataset] - Dataset object or file path
   * @param {string} [params.baselinePath] - Optional path to baseline report for regression check
   * @param {string} [params.outputPath] - Optional path to save run report JSON
   * @param {boolean} [params.verbose=false]
   * @returns {Promise<object>} Complete evaluation report
   */
  async run({
    dataset = null,
    baselinePath = null,
    outputPath = null,
    verbose = false,
  } = {}) {
    const runStartTime = Date.now();
    const runId = `eval-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // 1. Load dataset
    let ds;
    if (typeof dataset === 'string') {
      ds = loadEvaluationDataset(dataset);
    } else if (dataset && Array.isArray(dataset.samples)) {
      ds = dataset;
    } else {
      ds = loadEvaluationDataset();
    }

    const samples = ds.samples;
    const sampleResults = [];

    // 2. Process each sample
    for (const sample of samples) {
      let pipelineResult = null;
      let executionError = null;

      try {
        if (this.ragService) {
          pipelineResult = await this.ragService.query({
            question: sample.question,
            symbol: sample.symbol,
            filingType: sample.filing_type,
            topK: this.topK,
            organizationId: sample.organizationId || null,
          });
        } else if (sample.precomputed_result) {
          pipelineResult = sample.precomputed_result;
        } else {
          throw new Error('Neither RAGService nor precomputed_result provided for sample');
        }
      } catch (err) {
        executionError = err.message;
        pipelineResult = {
          answer: `Pipeline execution failed: ${err.message}`,
          citations: [],
          confidence: 0,
          retrievalCount: 0,
          retrievedContexts: [],
          agentTrace: [],
          cached: false,
        };
      }

      // Evaluate sample
      const evaluated = await this.evaluator.evaluateSample({
        sample,
        result: pipelineResult,
        topK: this.topK,
      });

      if (executionError) {
        evaluated.executionError = executionError;
      }

      sampleResults.push(evaluated);

      if (verbose) {
        console.log(`[${evaluated.sampleId}] ${evaluated.status.toUpperCase()} - ${sample.question.slice(0, 50)}...`);
      }
    }

    // 3. Compute Aggregates
    const aggregateMetrics = this.aggregateMetrics(sampleResults);

    // 4. Threshold Compliance
    const thresholdResults = this.checkThresholds(aggregateMetrics);

    // 5. Baseline Regression Analysis
    let regressionReport = null;
    if (baselinePath && fs.existsSync(baselinePath)) {
      try {
        const baselineData = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
        regressionReport = this.compareWithBaseline(aggregateMetrics, baselineData.aggregateMetrics, sampleResults, baselineData.sampleResults);
      } catch (err) {
        regressionReport = { error: `Failed to compare with baseline: ${err.message}` };
      }
    }

    const report = {
      runId,
      timestamp: new Date().toISOString(),
      datasetVersion: ds.datasetVersion || '1.0.0',
      datasetName: ds.name || 'Financial Benchmark',
      configuration: {
        topK: this.topK,
        thresholds: this.thresholds,
        llmJudge: this.llmJudge.getUsageReport(),
      },
      summary: {
        totalSamples: samples.length,
        passedSamples: sampleResults.filter(s => s.status === 'passed').length,
        failedSamples: sampleResults.filter(s => s.status === 'failed').length,
        durationMs: Date.now() - runStartTime,
        overallThresholdsPassed: thresholdResults.overallPassed,
      },
      thresholdResults,
      regressionReport,
      aggregateMetrics,
      sampleResults,
    };

    // Save report to disk if requested
    if (outputPath) {
      const outDir = path.dirname(path.resolve(outputPath));
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(path.resolve(outputPath), JSON.stringify(report, null, 2), 'utf-8');
    }

    return report;
  }

  /**
   * Aggregates metric scores across all samples.
   */
  aggregateMetrics(sampleResults) {
    const metricBuckets = {};

    for (const sample of sampleResults) {
      for (const [metricName, result] of Object.entries(sample.metrics || {})) {
        if (!metricBuckets[metricName]) {
          metricBuckets[metricName] = {
            scores: [],
            statuses: { passed: 0, failed: 0, skipped: 0, error: 0, not_applicable: 0 },
            isDeterministic: result.isDeterministic,
            isReferenceBased: result.isReferenceBased,
          };
        }

        const bucket = metricBuckets[metricName];
        if (result.status && bucket.statuses[result.status] !== undefined) {
          bucket.statuses[result.status]++;
        }

        if (result.score !== null && typeof result.score === 'number' && !isNaN(result.score)) {
          bucket.scores.push(result.score);
        }
      }
    }

    const aggregated = {};
    const totalSamples = sampleResults.length;

    for (const [metricName, bucket] of Object.entries(metricBuckets)) {
      const scores = bucket.scores;
      const evaluatedCount = scores.length;
      const coverage = totalSamples > 0 ? (evaluatedCount / totalSamples) : 0;

      if (evaluatedCount === 0) {
        aggregated[metricName] = {
          mean: null,
          median: null,
          min: null,
          max: null,
          evaluatedCount: 0,
          coverage: 0.0,
          statuses: bucket.statuses,
        };
        continue;
      }

      scores.sort((a, b) => a - b);
      const sum = scores.reduce((acc, s) => acc + s, 0);
      const mean = Math.round((sum / evaluatedCount) * 1000) / 1000;
      const median = evaluatedCount % 2 === 0
        ? Math.round(((scores[evaluatedCount / 2 - 1] + scores[evaluatedCount / 2]) / 2) * 1000) / 1000
        : Math.round(scores[Math.floor(evaluatedCount / 2)] * 1000) / 1000;
      const min = Math.round(scores[0] * 1000) / 1000;
      const max = Math.round(scores[scores.length - 1] * 1000) / 1000;

      aggregated[metricName] = {
        mean,
        median,
        min,
        max,
        evaluatedCount,
        coverage: Math.round(coverage * 100) / 100,
        statuses: bucket.statuses,
      };
    }

    return aggregated;
  }

  /**
   * Checks aggregated results against configured thresholds.
   */
  checkThresholds(aggregateMetrics) {
    const checks = {};
    let overallPassed = true;

    for (const [metricName, threshold] of Object.entries(this.thresholds)) {
      const agg = aggregateMetrics[metricName];
      if (!agg || agg.mean === null) {
        checks[metricName] = {
          threshold,
          actual: null,
          status: 'SKIPPED',
          reason: 'No samples evaluated for this metric',
        };
        continue;
      }

      const passed = agg.mean >= threshold;
      if (!passed) {
        overallPassed = false;
      }

      checks[metricName] = {
        threshold,
        actual: agg.mean,
        status: passed ? 'PASSED' : 'FAILED',
        reason: passed 
          ? `Score ${agg.mean} met threshold >= ${threshold}` 
          : `Score ${agg.mean} regressed below threshold ${threshold}`,
      };
    }

    return {
      overallPassed,
      checks,
    };
  }

  /**
   * Compares the current run with a baseline run to identify regressions or improvements.
   */
  compareWithBaseline(currentAggregates, baselineAggregates, currentSamples = [], baselineSamples = []) {
    if (!baselineAggregates) return null;

    const improved = [];
    const regressed = [];
    const unchanged = [];
    const nonComparable = [];

    for (const [metric, current] of Object.entries(currentAggregates)) {
      const base = baselineAggregates[metric];
      if (!base || base.mean === null || current.mean === null) {
        nonComparable.push(metric);
        continue;
      }

      const diff = Math.round((current.mean - base.mean) * 1000) / 1000;
      const comparisonItem = {
        metric,
        baselineScore: base.mean,
        currentScore: current.mean,
        delta: diff,
      };

      if (diff > 0.02) {
        improved.push(comparisonItem);
      } else if (diff < -0.02) {
        regressed.push(comparisonItem);
      } else {
        unchanged.push(comparisonItem);
      }
    }

    // Sample-level regression check
    const sampleRegressions = [];
    if (Array.isArray(baselineSamples) && baselineSamples.length > 0) {
      const baseSampleMap = new Map(baselineSamples.map(s => [s.sampleId, s]));
      for (const curr of currentSamples) {
        const base = baseSampleMap.get(curr.sampleId);
        if (base && base.status === 'passed' && curr.status === 'failed') {
          sampleRegressions.push({
            sampleId: curr.sampleId,
            question: curr.question,
            previousStatus: 'passed',
            currentStatus: 'failed',
            diagnosis: curr.failureDiagnosis,
          });
        }
      }
    }

    return {
      hasRegressions: regressed.length > 0 || sampleRegressions.length > 0,
      improved,
      regressed,
      unchanged,
      nonComparable,
      sampleRegressions,
    };
  }
}
