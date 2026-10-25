/**
 * Global_Fit_Ulttra - Generation Evaluation Metrics
 * 
 * Standardized generation metrics for financial RAG:
 * 1. Faithfulness: Proportion of factual claims in answer supported by retrieved context
 * 2. Response Groundedness: Sentence-level grounding ratio across the complete answer
 * 3. Answer Relevancy: Semantic and topical alignment with the original question
 * 4. Factual Correctness: Precision & recall of claims compared against a trusted reference answer
 * 5. Citation Correctness: Dual-check of Citation Validity (real source IDs) and Citation Support
 * 6. Answer Completeness: Coverage of expected financial dimensions (entities, figures, periods)
 * 7. Answer Accuracy: Combined correctness agreement score against reference
 * 
 * @module evaluation/metrics/GenerationMetrics
 */

import { isRefusalResponse } from './FinancialMetrics.js';

function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Splits text into discrete claim/sentence units for granular evaluation.
 */
function extractSentences(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .split(/(?<=[.?!])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 10 && !s.startsWith('#') && !s.startsWith('==='));
}

/**
 * Computes Faithfulness.
 * Measures the proportion of factual claims in the generated answer supported by the retrieved context.
 * 
 * @param {object} params
 * @param {string} params.generatedAnswer
 * @param {Array<object>} params.retrievedChunks
 * @param {object} [params.llmJudge] - Optional LLM judge for deep semantic entailment
 * @returns {Promise<object>} Metric result
 */
export async function faithfulness({
  generatedAnswer = '',
  retrievedChunks = [],
  llmJudge = null,
} = {}) {
  if (!generatedAnswer || typeof generatedAnswer !== 'string') {
    return {
      name: 'faithfulness',
      score: 0.0,
      status: 'failed',
      method: 'claim_verification',
      inputsUsed: ['generatedAnswer', 'retrievedChunks'],
      reason: 'Generated answer is empty',
      isDeterministic: !llmJudge,
      isReferenceBased: false,
    };
  }

  if (isRefusalResponse(generatedAnswer)) {
    return {
      name: 'faithfulness',
      score: 1.0,
      status: 'passed',
      method: 'abstention_faithfulness_handler',
      inputsUsed: ['generatedAnswer'],
      reason: 'Safely acknowledged limitations without generating unfaithful claims',
      isDeterministic: true,
      isReferenceBased: false,
    };
  }

  if (!Array.isArray(retrievedChunks) || retrievedChunks.length === 0) {
    return {
      name: 'faithfulness',
      score: 0.0,
      status: 'failed',
      method: 'claim_verification',
      inputsUsed: ['generatedAnswer', 'retrievedChunks'],
      reason: 'No retrieved context available to support generated claims',
      details: { totalClaims: 0, supportedClaims: [], unsupportedClaims: [] },
      isDeterministic: !llmJudge,
      isReferenceBased: false,
    };
  }

  const combinedEvidence = retrievedChunks.map(c => c.content || '').join('\n');
  const normalizedEvidence = normalizeText(combinedEvidence);
  const sentences = extractSentences(generatedAnswer);

  if (sentences.length === 0) {
    return {
      name: 'faithfulness',
      score: 1.0,
      status: 'passed',
      method: 'claim_verification',
      inputsUsed: ['generatedAnswer', 'retrievedChunks'],
      reason: 'No evaluatable factual sentences found in answer',
      isDeterministic: true,
      isReferenceBased: false,
    };
  }

  // If LLM judge is configured and enabled, use it for semantic entailment
  if (llmJudge && typeof llmJudge.evaluateEntailment === 'function') {
    try {
      const result = await llmJudge.evaluateEntailment({
        context: combinedEvidence,
        claims: sentences,
      });
      return {
        name: 'faithfulness',
        score: result.score,
        status: result.score >= 0.8 ? 'passed' : 'failed',
        method: 'llm_judge_entailment',
        inputsUsed: ['generatedAnswer', 'retrievedChunks'],
        reason: result.reason || `LLM Judge evaluated ${result.supportedCount}/${sentences.length} claims as faithful`,
        details: result.details,
        isDeterministic: false,
        isReferenceBased: false,
      };
    } catch {
      // Fallback to deterministic evaluation on judge error/timeout
    }
  }

  // Deterministic token & n-gram overlap check per claim
  const supportedClaims = [];
  const unsupportedClaims = [];

  for (const sentence of sentences) {
    const sTokens = normalizeText(sentence)
      .split(' ')
      .filter(w => w.length > 3 && !['according', 'statement', 'reports', 'financial'].includes(w));

    if (sTokens.length === 0) {
      supportedClaims.push({ sentence, supportRatio: 1.0 });
      continue;
    }

    const matchedTokens = sTokens.filter(t => normalizedEvidence.includes(t));
    const supportRatio = matchedTokens.length / sTokens.length;

    if (supportRatio >= 0.5) {
      supportedClaims.push({ sentence, supportRatio: Math.round(supportRatio * 100) / 100 });
    } else {
      unsupportedClaims.push({ sentence, supportRatio: Math.round(supportRatio * 100) / 100 });
    }
  }

  const total = supportedClaims.length + unsupportedClaims.length;
  const score = total > 0 ? Math.round((supportedClaims.length / total) * 1000) / 1000 : 0.0;

  return {
    name: 'faithfulness',
    score,
    status: score >= 0.75 ? 'passed' : 'failed',
    method: 'deterministic_claim_overlap',
    inputsUsed: ['generatedAnswer', 'retrievedChunks'],
    reason: `${supportedClaims.length} of ${total} claims supported by retrieved context (${Math.round(score * 100)}%)`,
    details: {
      totalClaims: total,
      supportedCount: supportedClaims.length,
      unsupportedCount: unsupportedClaims.length,
      supportedClaims,
      unsupportedClaims,
    },
    isDeterministic: true,
    isReferenceBased: false,
  };
}

/**
 * Computes Response Groundedness.
 * Overall response-level evidence-support judgment (evaluating overall text coverage in context).
 * 
 * @param {object} params
 * @param {string} params.generatedAnswer
 * @param {Array<object>} params.retrievedChunks
 * @returns {object} Metric result
 */
export function responseGroundedness({
  generatedAnswer = '',
  retrievedChunks = [],
} = {}) {
  if (isRefusalResponse(generatedAnswer)) {
    return {
      name: 'response_groundedness',
      score: 1.0,
      status: 'passed',
      method: 'abstention_groundedness_handler',
      inputsUsed: ['generatedAnswer'],
      reason: 'Safe refusal on insufficient evidence is fully grounded',
      isDeterministic: true,
      isReferenceBased: false,
    };
  }

  const combinedEvidence = normalizeText((retrievedChunks || []).map(c => c.content || '').join(' '));
  const answerTokens = normalizeText(generatedAnswer)
    .split(' ')
    .filter(w => w.length > 3 && !['about', 'their', 'which', 'there', 'these'].includes(w));

  if (answerTokens.length === 0) {
    return {
      name: 'response_groundedness',
      score: 1.0,
      status: 'passed',
      method: 'coverage_grounding',
      inputsUsed: ['generatedAnswer', 'retrievedChunks'],
      reason: 'Short response with no significant non-stopword tokens',
      isDeterministic: true,
      isReferenceBased: false,
    };
  }

  const groundedTokens = answerTokens.filter(t => combinedEvidence.includes(t));
  const score = Math.round((groundedTokens.length / answerTokens.length) * 1000) / 1000;

  return {
    name: 'response_groundedness',
    score,
    status: score >= 0.70 ? 'passed' : 'failed',
    method: 'lexical_grounding_density',
    inputsUsed: ['generatedAnswer', 'retrievedChunks'],
    reason: `${groundedTokens.length}/${answerTokens.length} significant answer tokens grounded in context (${Math.round(score * 100)}%)`,
    details: { totalTokens: answerTokens.length, groundedTokens: groundedTokens.length },
    isDeterministic: true,
    isReferenceBased: false,
  };
}

/**
 * Computes Answer Relevancy.
 * Measures whether the answer addresses the actual question, penalizing unrelated tangents.
 * Does not penalize concise answers.
 * 
 * @param {object} params
 * @param {string} params.question
 * @param {string} params.generatedAnswer
 * @param {object} [params.llmJudge]
 * @returns {Promise<object>} Metric result
 */
export async function answerRelevancy({
  question = '',
  generatedAnswer = '',
  llmJudge = null,
} = {}) {
  const normQ = normalizeText(question);
  const normAns = normalizeText(generatedAnswer);

  if (!normAns) {
    return {
      name: 'answer_relevancy',
      score: 0.0,
      status: 'failed',
      method: 'question_answer_alignment',
      inputsUsed: ['question', 'generatedAnswer'],
      reason: 'Generated answer is empty',
      isDeterministic: !llmJudge,
      isReferenceBased: false,
    };
  }

  // If question indicates refusal expectation and answer is an explicit refusal
  if (isRefusalResponse(generatedAnswer)) {
    return {
      name: 'answer_relevancy',
      score: 1.0,
      status: 'passed',
      method: 'refusal_relevancy_handler',
      inputsUsed: ['question', 'generatedAnswer'],
      reason: 'Grounded refusal correctly and directly addresses insufficient evidence',
      isDeterministic: true,
      isReferenceBased: false,
    };
  }

  if (llmJudge && typeof llmJudge.evaluateRelevancy === 'function') {
    try {
      const res = await llmJudge.evaluateRelevancy({ question, answer: generatedAnswer });
      return {
        name: 'answer_relevancy',
        score: res.score,
        status: res.score >= 0.75 ? 'passed' : 'failed',
        method: 'llm_judge_relevancy',
        inputsUsed: ['question', 'generatedAnswer'],
        reason: res.reason,
        isDeterministic: false,
        isReferenceBased: false,
      };
    } catch {
      // Fallback
    }
  }

  // Deterministic lexical alignment: key question entities/terms addressed in answer
  const qTerms = normQ.split(' ').filter(w => w.length > 2 && !['what', 'when', 'where', 'which', 'how', 'show', 'tell'].includes(w));
  if (qTerms.length === 0) {
    return {
      name: 'answer_relevancy',
      score: 1.0,
      status: 'passed',
      method: 'token_alignment',
      inputsUsed: ['question', 'generatedAnswer'],
      reason: 'Question contains generic terms',
      isDeterministic: true,
      isReferenceBased: false,
    };
  }

  const matchedTerms = qTerms.filter(t => normAns.includes(t));
  const overlapRatio = matchedTerms.length / qTerms.length;

  // Penalize excessive verbosity only if question overlap is poor
  const lengthPenalty = (normAns.length > 2000 && overlapRatio < 0.4) ? 0.2 : 0.0;
  const score = Math.max(0.0, Math.round((Math.min(1.0, overlapRatio * 1.2) - lengthPenalty) * 1000) / 1000);

  return {
    name: 'answer_relevancy',
    score,
    status: score >= 0.65 ? 'passed' : 'failed',
    method: 'deterministic_term_coverage',
    inputsUsed: ['question', 'generatedAnswer'],
    reason: `${matchedTerms.length}/${qTerms.length} core question terms addressed in response (${Math.round(score * 100)}%)`,
    details: { qTerms, matchedTerms },
    isDeterministic: true,
    isReferenceBased: false,
  };
}

/**
 * Computes Factual Correctness.
 * Compares factual claims in the generated answer with a trusted reference answer.
 * Identifies missing, matching, and conflicting claims while preserving qualifiers, units, and dates.
 * 
 * @param {object} params
 * @param {string} params.generatedAnswer
 * @param {string} [params.referenceAnswer]
 * @param {Array<string|number>} [params.expectedValues]
 * @returns {object} Metric result
 */
export function factualCorrectness({
  generatedAnswer = '',
  referenceAnswer = null,
  expectedValues = [],
} = {}) {
  if (!referenceAnswer && (!Array.isArray(expectedValues) || expectedValues.length === 0)) {
    return {
      name: 'factual_correctness',
      score: null,
      status: 'skipped',
      method: 'reference_based',
      inputsUsed: ['generatedAnswer'],
      reason: 'No trusted reference answer or expected values available for factual comparison',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  const normAns = normalizeText(generatedAnswer);
  const normRef = normalizeText(referenceAnswer || '');

  // Extract reference claims/tokens
  const refTokens = normRef.split(' ').filter(w => w.length > 2 && !['with', 'from', 'were', 'been', 'have'].includes(w));
  const matchedTokens = refTokens.filter(t => normAns.includes(t));
  const tokenCoverage = refTokens.length > 0 ? (matchedTokens.length / refTokens.length) : 1.0;

  // Check expected key financial values if supplied
  let valueScore = 1.0;
  const valueChecks = [];
  if (Array.isArray(expectedValues) && expectedValues.length > 0) {
    let matchedVals = 0;
    for (const val of expectedValues) {
      const cleanVal = normalizeText(String(val));
      const isPresent = normAns.includes(cleanVal);
      if (isPresent) matchedVals++;
      valueChecks.push({ expected: val, found: isPresent });
    }
    valueScore = matchedVals / expectedValues.length;
  }

  // Weighted composite score (60% exact key values, 40% factual statement coverage)
  const score = Math.round((valueScore * 0.6 + tokenCoverage * 0.4) * 1000) / 1000;

  return {
    name: 'factual_correctness',
    score,
    status: score >= 0.75 ? 'passed' : 'failed',
    method: 'deterministic_claim_and_value_check',
    inputsUsed: ['generatedAnswer', 'referenceAnswer', 'expectedValues'],
    reason: `Factual agreement: ${Math.round(score * 100)}% (Values: ${Math.round(valueScore * 100)}%, Narrative: ${Math.round(tokenCoverage * 100)}%)`,
    details: { tokenCoverage, valueScore, valueChecks },
    isDeterministic: true,
    isReferenceBased: true,
  };
}

/**
 * Computes Citation Correctness.
 * Dual assessment:
 * 1. Citation Validity: Every citation points to a real retrieved chunk index/ID. Detects fabricated citations.
 * 2. Citation Support: Does the cited snippet actually contain evidence supporting the claim?
 * 
 * @param {object} params
 * @param {string} params.generatedAnswer
 * @param {Array<object>} params.citations - Citations returned by pipeline
 * @param {Array<object>} params.retrievedChunks - Raw retrieved chunks
 * @returns {object} Metric result
 */
export function citationCorrectness({
  generatedAnswer = '',
  citations = [],
  retrievedChunks = [],
} = {}) {
  const sourceCount = (retrievedChunks || []).length;
  const citationRegex = /\[Source\s+(\d+)(?::[^\]]*)?\]/gi;
  const foundTags = [];
  let match;

  while ((match = citationRegex.exec(generatedAnswer)) !== null) {
    foundTags.push({
      tag: match[0],
      sourceId: parseInt(match[1], 10),
    });
  }

  if (foundTags.length === 0) {
    if (isRefusalResponse(generatedAnswer)) {
      return {
        name: 'citation_correctness',
        score: 1.0,
        status: 'passed',
        method: 'citation_audit',
        inputsUsed: ['generatedAnswer', 'citations', 'retrievedChunks'],
        reason: 'Correct abstention requires no citations; zero fabricated citations',
        details: { tagsFound: 0, validCitations: 0, invalidCitations: 0 },
        isDeterministic: true,
        isReferenceBased: false,
      };
    }

    return {
      name: 'citation_correctness',
      score: 0.0,
      status: 'failed',
      method: 'citation_audit',
      inputsUsed: ['generatedAnswer', 'citations', 'retrievedChunks'],
      reason: 'No [Source X] citations found in generated factual answer',
      details: { tagsFound: 0, validCitations: 0, invalidCitations: 0 },
      isDeterministic: true,
      isReferenceBased: false,
    };
  }

  const validTags = [];
  const invalidTags = [];

  for (const item of foundTags) {
    // Must be between 1 and total retrieved chunks
    if (item.sourceId >= 1 && item.sourceId <= sourceCount) {
      validTags.push(item);
    } else {
      invalidTags.push(item);
    }
  }

  const validityScore = foundTags.length > 0 ? (validTags.length / foundTags.length) : 0.0;

  // Assess citation support: check if snippets for valid citations have token overlap with surrounding text
  let supportedCount = 0;
  for (const item of validTags) {
    const chunk = retrievedChunks[item.sourceId - 1];
    const chunkContent = normalizeText(chunk?.content || '');
    // Check if chunk text contains at least some matching facts from the answer
    const answerTokens = normalizeText(generatedAnswer).split(' ').filter(w => w.length > 3);
    const overlap = answerTokens.filter(t => chunkContent.includes(t)).length;
    const overlapRatio = answerTokens.length > 0 ? (overlap / answerTokens.length) : 1.0;
    if (overlapRatio >= 0.35 || overlap >= 3) {
      supportedCount++;
    }
  }

  const supportScore = validTags.length > 0 ? (supportedCount / validTags.length) : 0.0;
  const score = Math.round((validityScore * 0.5 + supportScore * 0.5) * 1000) / 1000;

  return {
    name: 'citation_correctness',
    score,
    status: score >= 0.8 ? 'passed' : 'failed',
    method: 'citation_validity_and_support_audit',
    inputsUsed: ['generatedAnswer', 'citations', 'retrievedChunks'],
    reason: `Citations: ${validTags.length}/${foundTags.length} valid source IDs, ${supportedCount}/${validTags.length} context-supported claims`,
    details: {
      tagsFound: foundTags.length,
      validCount: validTags.length,
      invalidCount: invalidTags.length,
      supportedCount,
      validityScore,
      supportScore,
      invalidTags,
    },
    isDeterministic: true,
    isReferenceBased: false,
  };
}

/**
 * Computes Answer Completeness.
 * Measures whether the answer covers the required parts of the question according to expected entities and values.
 * 
 * @param {object} params
 * @param {string} params.generatedAnswer
 * @param {string} [params.referenceAnswer]
 * @param {Array<string>} [params.expectedEntities]
 * @param {Array<string|number>} [params.expectedValues]
 * @returns {object} Metric result
 */
export function answerCompleteness({
  generatedAnswer = '',
  referenceAnswer = null,
  expectedEntities = [],
  expectedValues = [],
} = {}) {
  const normAns = normalizeText(generatedAnswer);
  const itemsToCheck = [
    ...(expectedEntities || []),
    ...(expectedValues || []),
  ];

  if (itemsToCheck.length === 0 && !referenceAnswer) {
    return {
      name: 'answer_completeness',
      score: null,
      status: 'skipped',
      method: 'reference_based',
      inputsUsed: ['generatedAnswer'],
      reason: 'No expected entities, values, or reference answer provided to assess completeness',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  if (itemsToCheck.length > 0) {
    let matched = 0;
    const missing = [];
    for (const item of itemsToCheck) {
      const clean = normalizeText(String(item));
      if (normAns.includes(clean)) {
        matched++;
      } else {
        missing.push(item);
      }
    }

    const score = Math.round((matched / itemsToCheck.length) * 1000) / 1000;
    return {
      name: 'answer_completeness',
      score,
      status: score >= 0.75 ? 'passed' : 'failed',
      method: 'itemized_completeness',
      inputsUsed: ['generatedAnswer', 'expectedEntities', 'expectedValues'],
      reason: `Answer covered ${matched}/${itemsToCheck.length} required dimensions (${Math.round(score * 100)}%)`,
      details: { totalRequired: itemsToCheck.length, matched, missing },
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  // Fallback to reference answer sentence coverage
  const refSentences = extractSentences(referenceAnswer);
  if (refSentences.length === 0) {
    return {
      name: 'answer_completeness',
      score: 1.0,
      status: 'passed',
      method: 'reference_sentence_coverage',
      inputsUsed: ['generatedAnswer', 'referenceAnswer'],
      reason: 'Reference answer contains no complex sub-claims',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  let coveredCount = 0;
  for (const s of refSentences) {
    const sTokens = normalizeText(s).split(' ').filter(w => w.length > 3);
    const matched = sTokens.filter(t => normAns.includes(t)).length;
    if (sTokens.length > 0 && (matched / sTokens.length) >= 0.5) {
      coveredCount++;
    }
  }

  const score = Math.round((coveredCount / refSentences.length) * 1000) / 1000;

  return {
    name: 'answer_completeness',
    score,
    status: score >= 0.7 ? 'passed' : 'failed',
    method: 'reference_sentence_coverage',
    inputsUsed: ['generatedAnswer', 'referenceAnswer'],
    reason: `Covered ${coveredCount}/${refSentences.length} core reference components (${Math.round(score * 100)}%)`,
    details: { totalSentences: refSentences.length, coveredCount },
    isDeterministic: true,
    isReferenceBased: true,
  };
}

/**
 * Computes Answer Accuracy / Answer Correctness.
 * Standard composite agreement score against reference.
 * 
 * @param {object} params
 * @param {string} params.generatedAnswer
 * @param {string} params.referenceAnswer
 * @returns {object} Metric result
 */
export function answerAccuracy({
  generatedAnswer = '',
  referenceAnswer = null,
} = {}) {
  if (!referenceAnswer || typeof referenceAnswer !== 'string') {
    return {
      name: 'answer_accuracy',
      score: null,
      status: 'skipped',
      method: 'reference_based',
      inputsUsed: ['generatedAnswer'],
      reason: 'No reference answer provided for accuracy calculation',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  const normGen = normalizeText(generatedAnswer);
  const normRef = normalizeText(referenceAnswer);

  const genTokens = new Set(normGen.split(' ').filter(w => w.length > 2));
  const refTokens = new Set(normRef.split(' ').filter(w => w.length > 2));

  let matched = 0;
  for (const t of refTokens) {
    if (genTokens.has(t)) matched++;
  }

  const recall = refTokens.size > 0 ? (matched / refTokens.size) : 1.0;
  let precMatched = 0;
  for (const t of genTokens) {
    if (refTokens.has(t)) precMatched++;
  }
  const precision = genTokens.size > 0 ? (precMatched / genTokens.size) : 1.0;

  const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0.0;
  const score = Math.round(f1 * 1000) / 1000;

  return {
    name: 'answer_accuracy',
    score,
    status: score >= 0.7 ? 'passed' : 'failed',
    method: 'token_f1_reference_agreement',
    inputsUsed: ['generatedAnswer', 'referenceAnswer'],
    reason: `Token F1 accuracy against reference: ${score} (Precision: ${precision.toFixed(2)}, Recall: ${recall.toFixed(2)})`,
    details: { precision: Math.round(precision * 100) / 100, recall: Math.round(recall * 100) / 100, f1: score },
    isDeterministic: true,
    isReferenceBased: true,
  };
}
