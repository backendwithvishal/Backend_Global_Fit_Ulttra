/**
 * Global_Fit_Ulttra - Retrieval Evaluation Metrics
 * 
 * Standardized reference-based and context-based retrieval metrics for financial RAG:
 * 1. Context Precision@K: Mean reciprocal precision weighted by relevance at each rank
 * 2. Context Recall: Proportion of reference claims/facts found in retrieved context
 * 3. Context Entities Recall: Coverage of required financial entities (tickers, metrics, periods, values)
 * 4. Context Utilization: How effectively retrieved context is reflected in answer
 * 5. Recall@K: Proportion of known relevant documents retrieved within top K
 * 6. MRR (Mean Reciprocal Rank): Reciprocal rank of the first relevant chunk
 * 7. nDCG@K: Normalized Discounted Cumulative Gain at rank K
 * 8. Context Relevance: Question-to-context semantic and lexical alignment
 * 9. Noise Sensitivity: Answer degradation when irrelevant/distracting context is added
 * 
 * @module evaluation/metrics/RetrievalMetrics
 */

/**
 * Normalizes text for lexical comparison.
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Computes Context Precision@K.
 * Standard Ragas definition:
 * Context Precision@K = sum_{k=1}^K (Precision@k * v_k) / (Total relevant items in top K)
 * where v_k in {0, 1} is relevance indicator at rank k.
 * 
 * @param {object} params
 * @param {Array<object>} params.retrievedChunks - Ordered retrieved chunks
 * @param {Array<string>} [params.referenceContextIds] - IDs of known relevant chunks
 * @param {Array<string>} [params.referenceContexts] - Key text passages of relevant chunks
 * @param {number} [params.topK=4] - Cutoff rank
 * @returns {object} Metric result { score, status, reason, details }
 */
export function contextPrecision({
  retrievedChunks = [],
  referenceContextIds = null,
  referenceContexts = null,
  topK = 4,
} = {}) {
  if (
    (!referenceContextIds || referenceContextIds.length === 0) &&
    (!referenceContexts || referenceContexts.length === 0)
  ) {
    return {
      name: 'context_precision',
      score: null,
      status: 'not_applicable',
      method: 'reference_based',
      inputsUsed: ['retrievedChunks'],
      reason: 'No reference context IDs or reference contexts provided for ground-truth comparison',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  if (!Array.isArray(retrievedChunks) || retrievedChunks.length === 0) {
    return {
      name: 'context_precision',
      score: 0.0,
      status: 'failed',
      method: 'reference_based',
      inputsUsed: ['retrievedChunks', 'referenceContextIds'],
      reason: 'No chunks were retrieved',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  const kChunks = retrievedChunks.slice(0, topK);
  const refIdSet = new Set((referenceContextIds || []).map(id => String(id).toLowerCase().trim()));
  const normalizedRefTexts = (referenceContexts || []).map(normalizeText).filter(Boolean);

  let relevantCount = 0;
  let runningSum = 0;
  const chunkAssessments = [];

  for (let i = 0; i < kChunks.length; i++) {
    const chunk = kChunks[i];
    const chunkId = String(chunk.id || chunk._id || chunk.documentId || '').toLowerCase().trim();
    const chunkContent = normalizeText(chunk.content || '');

    let isRelevant = false;
    if (refIdSet.size > 0 && refIdSet.has(chunkId)) {
      isRelevant = true;
    } else if (normalizedRefTexts.length > 0) {
      // Check if reference context shares significant token overlap with chunk
      isRelevant = normalizedRefTexts.some(refText => {
        const refTokens = refText.split(' ').filter(t => t.length > 3);
        if (refTokens.length === 0) return chunkContent.includes(refText);
        const matchCount = refTokens.filter(t => chunkContent.includes(t)).length;
        return (matchCount / refTokens.length) >= 0.5;
      });
    }

    if (isRelevant) {
      relevantCount++;
      const precisionAtK = relevantCount / (i + 1);
      runningSum += precisionAtK;
    }

    chunkAssessments.push({
      rank: i + 1,
      id: chunkId,
      isRelevant,
    });
  }

  if (relevantCount === 0) {
    return {
      name: 'context_precision',
      score: 0.0,
      status: 'failed',
      method: 'reference_based',
      inputsUsed: ['retrievedChunks', 'referenceContextIds'],
      reason: `None of the top ${kChunks.length} retrieved chunks matched reference evidence`,
      details: { topK, relevantCount, chunkAssessments },
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  const score = Math.round((runningSum / relevantCount) * 1000) / 1000;

  return {
    name: 'context_precision',
    score,
    status: score >= 0.7 ? 'passed' : 'failed',
    method: 'reference_based',
    inputsUsed: ['retrievedChunks', 'referenceContextIds'],
    reason: `Evaluated ${kChunks.length} chunks; ${relevantCount} relevant items with precision score ${score}`,
    details: { topK, relevantCount, chunkAssessments },
    isDeterministic: true,
    isReferenceBased: true,
  };
}

/**
 * Computes Context Recall.
 * Measures whether the retrieved context contains the information needed to answer the question,
 * by comparing against reference answers or reference claims.
 * 
 * @param {object} params
 * @param {Array<object>} params.retrievedChunks
 * @param {string} [params.referenceAnswer]
 * @param {Array<string>} [params.referenceClaims]
 * @param {Array<string>} [params.referenceContexts]
 * @returns {object} Metric result
 */
export function contextRecall({
  retrievedChunks = [],
  referenceAnswer = null,
  referenceClaims = null,
  referenceContexts = null,
} = {}) {
  const combinedEvidence = (retrievedChunks || [])
    .map(c => (c.content || ''))
    .join(' ');
  const normalizedEvidence = normalizeText(combinedEvidence);

  // Derive target claims to look for
  let targetClaims = [];
  if (Array.isArray(referenceClaims) && referenceClaims.length > 0) {
    targetClaims = referenceClaims;
  } else if (referenceAnswer && typeof referenceAnswer === 'string') {
    // Split reference answer into sentence-level claims
    targetClaims = referenceAnswer
      .split(/(?<=[.?!])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 15);
  } else if (Array.isArray(referenceContexts) && referenceContexts.length > 0) {
    targetClaims = referenceContexts;
  }

  if (targetClaims.length === 0) {
    return {
      name: 'context_recall',
      score: null,
      status: 'skipped',
      method: 'reference_based',
      inputsUsed: ['retrievedChunks'],
      reason: 'No reference answer, reference claims, or reference contexts available to assess recall',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  if (normalizedEvidence.length === 0) {
    return {
      name: 'context_recall',
      score: 0.0,
      status: 'failed',
      method: 'reference_based',
      inputsUsed: ['retrievedChunks', 'referenceClaims'],
      reason: 'Retrieved context is empty; 0% of reference claims were retrieved',
      details: { totalClaims: targetClaims.length, supportedClaims: 0, missingClaims: targetClaims },
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  const supported = [];
  const missing = [];

  for (const claim of targetClaims) {
    const claimTokens = normalizeText(claim).split(' ').filter(w => w.length > 2);
    if (claimTokens.length === 0) continue;

    // Check key token matching
    const matchedCount = claimTokens.filter(t => normalizedEvidence.includes(t)).length;
    const matchRatio = matchedCount / claimTokens.length;

    if (matchRatio >= 0.6) {
      supported.push({ claim, matchRatio: Math.round(matchRatio * 100) / 100 });
    } else {
      missing.push({ claim, matchRatio: Math.round(matchRatio * 100) / 100 });
    }
  }

  const total = supported.length + missing.length;
  const score = total > 0 ? Math.round((supported.length / total) * 1000) / 1000 : 0.0;

  return {
    name: 'context_recall',
    score,
    status: score >= 0.7 ? 'passed' : 'failed',
    method: 'deterministic_token_coverage',
    inputsUsed: ['retrievedChunks', 'referenceAnswer'],
    reason: `${supported.length} of ${total} reference claims/facts supported in retrieved context (${Math.round(score * 100)}%)`,
    details: {
      totalClaims: total,
      supportedCount: supported.length,
      missingCount: missing.length,
      supported,
      missing,
    },
    isDeterministic: true,
    isReferenceBased: true,
  };
}

/**
 * Computes Context Entities Recall.
 * Measures whether the retrieved context contains the important financial entities required.
 * Entities include tickers, company names, reporting periods, metrics, currencies, and numeric values.
 * 
 * @param {object} params
 * @param {Array<object>} params.retrievedChunks
 * @param {Array<string|object>} params.referenceEntities
 * @returns {object} Metric result
 */
export function contextEntitiesRecall({
  retrievedChunks = [],
  referenceEntities = [],
  expectedBehavior = 'ANSWER',
} = {}) {
  if (expectedBehavior === 'REFUSE' || expectedBehavior === 'SECURITY_ISOLATION') {
    return {
      name: 'context_entities_recall',
      score: null,
      status: 'not_applicable',
      method: 'reference_based',
      inputsUsed: ['retrievedChunks'],
      reason: 'Negative/unanswerable test query: entity absence expected in knowledge base',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  if (!Array.isArray(referenceEntities) || referenceEntities.length === 0) {
    return {
      name: 'context_entities_recall',
      score: null,
      status: 'skipped',
      method: 'reference_based',
      inputsUsed: ['retrievedChunks'],
      reason: 'No reference entities specified in dataset record',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  const combinedEvidence = (retrievedChunks || [])
    .map(c => `${c.content || ''} ${c.metadata?.symbol || ''} ${c.metadata?.filingType || ''} ${c.metadata?.section || ''}`)
    .join(' ');
  const normalizedEvidence = normalizeText(combinedEvidence);

  const matched = [];
  const missing = [];

  for (const ent of referenceEntities) {
    const rawVal = typeof ent === 'string' ? ent : (ent.value || ent.name || '');
    const cleanVal = normalizeText(rawVal);
    if (!cleanVal) continue;

    // Strict value check
    const isPresent = normalizedEvidence.includes(cleanVal);
    if (isPresent) {
      matched.push(rawVal);
    } else {
      missing.push(rawVal);
    }
  }

  const total = matched.length + missing.length;
  const score = total > 0 ? Math.round((matched.length / total) * 1000) / 1000 : 0.0;

  return {
    name: 'context_entities_recall',
    score,
    status: score >= 0.8 ? 'passed' : 'failed',
    method: 'entity_matching',
    inputsUsed: ['retrievedChunks', 'referenceEntities'],
    reason: `${matched.length}/${total} reference financial entities detected in retrieved context (${Math.round(score * 100)}%)`,
    details: { total, matched, missing },
    isDeterministic: true,
    isReferenceBased: true,
  };
}

/**
 * Computes Context Utilization.
 * Evaluates how effectively retrieved chunks are used to produce the generated answer.
 * Formula: Proportion of retrieved chunks whose content is referenced, cited, or reflected in the answer.
 * 
 * @param {object} params
 * @param {Array<object>} params.retrievedChunks
 * @param {string} params.generatedAnswer
 * @returns {object} Metric result
 */
export function contextUtilization({
  retrievedChunks = [],
  generatedAnswer = '',
} = {}) {
  if (!generatedAnswer || typeof generatedAnswer !== 'string') {
    return {
      name: 'context_utilization',
      score: 0.0,
      status: 'failed',
      method: 'context_answer_alignment',
      inputsUsed: ['retrievedChunks', 'generatedAnswer'],
      reason: 'Generated answer is empty',
      isDeterministic: true,
      isReferenceBased: false,
    };
  }

  if (!Array.isArray(retrievedChunks) || retrievedChunks.length === 0) {
    return {
      name: 'context_utilization',
      score: null,
      status: 'not_applicable',
      method: 'context_answer_alignment',
      inputsUsed: ['retrievedChunks', 'generatedAnswer'],
      reason: 'No retrieved chunks available to assess utilization',
      isDeterministic: true,
      isReferenceBased: false,
    };
  }

  const normAnswer = normalizeText(generatedAnswer);
  let utilizedCount = 0;
  const chunkUtilization = [];

  for (let i = 0; i < retrievedChunks.length; i++) {
    const chunk = retrievedChunks[i];
    const sourceTag = `[source ${i + 1}]`;
    const isExplicitlyCited = normAnswer.includes(sourceTag.toLowerCase()) || 
      generatedAnswer.toLowerCase().includes(sourceTag);

    // Extract informative terms from chunk
    const chunkTokens = normalizeText(chunk.content || '')
      .split(' ')
      .filter(w => w.length > 4 && !['company', 'quarter', 'financial', 'report', 'statements'].includes(w));

    let lexicalOverlap = 0;
    if (chunkTokens.length > 0) {
      const matchTokens = chunkTokens.filter(t => normAnswer.includes(t));
      lexicalOverlap = matchTokens.length / chunkTokens.length;
    }

    const isUtilized = isExplicitlyCited || lexicalOverlap >= 0.15;
    if (isUtilized) utilizedCount++;

    chunkUtilization.push({
      rank: i + 1,
      isExplicitlyCited,
      lexicalOverlap: Math.round(lexicalOverlap * 100) / 100,
      isUtilized,
    });
  }

  const score = Math.round((utilizedCount / retrievedChunks.length) * 1000) / 1000;

  return {
    name: 'context_utilization',
    score,
    status: score >= 0.5 ? 'passed' : 'failed',
    method: 'lexical_and_citation_usage',
    inputsUsed: ['retrievedChunks', 'generatedAnswer'],
    reason: `${utilizedCount} of ${retrievedChunks.length} retrieved chunks utilized in response (${Math.round(score * 100)}%)`,
    details: { totalChunks: retrievedChunks.length, utilizedCount, chunkUtilization },
    isDeterministic: true,
    isReferenceBased: false,
  };
}

/**
 * Computes Recall@K.
 * Proportion of known relevant evidence chunks retrieved within top K.
 * 
 * @param {object} params
 * @param {Array<object>} params.retrievedChunks
 * @param {Array<string>} params.referenceContextIds
 * @param {number} [params.k=4]
 * @returns {object} Metric result
 */
export function recallAtK({
  retrievedChunks = [],
  referenceContextIds = [],
  k = 4,
} = {}) {
  if (!Array.isArray(referenceContextIds) || referenceContextIds.length === 0) {
    return {
      name: `recall_at_${k}`,
      score: null,
      status: 'skipped',
      method: 'reference_based',
      inputsUsed: ['retrievedChunks'],
      reason: 'No reference context IDs available for Recall@K evaluation',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  const topKChunks = (retrievedChunks || []).slice(0, k);
  const retrievedIdSet = new Set(topKChunks.map(c => String(c.id || c._id || c.documentId || '').toLowerCase().trim()));

  const matchedIds = referenceContextIds.filter(refId => retrievedIdSet.has(String(refId).toLowerCase().trim()));
  const score = Math.round((matchedIds.length / referenceContextIds.length) * 1000) / 1000;

  return {
    name: `recall_at_${k}`,
    score,
    status: score >= 0.75 ? 'passed' : 'failed',
    method: 'set_overlap',
    inputsUsed: ['retrievedChunks', 'referenceContextIds'],
    reason: `Retrieved ${matchedIds.length}/${referenceContextIds.length} expected chunks in top ${k}`,
    details: { k, totalExpected: referenceContextIds.length, matchedCount: matchedIds.length, matchedIds },
    isDeterministic: true,
    isReferenceBased: true,
  };
}

/**
 * Computes Mean Reciprocal Rank (MRR).
 * Reciprocal rank of the highest-ranked relevant chunk (1 / rank), or 0 if none found.
 * 
 * @param {object} params
 * @param {Array<object>} params.retrievedChunks
 * @param {Array<string>} params.referenceContextIds
 * @returns {object} Metric result
 */
export function mrr({
  retrievedChunks = [],
  referenceContextIds = [],
} = {}) {
  if (!Array.isArray(referenceContextIds) || referenceContextIds.length === 0) {
    return {
      name: 'mrr',
      score: null,
      status: 'skipped',
      method: 'reference_based',
      inputsUsed: ['retrievedChunks'],
      reason: 'No reference context IDs available for MRR calculation',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  const refSet = new Set(referenceContextIds.map(id => String(id).toLowerCase().trim()));
  let firstRank = null;

  for (let i = 0; i < retrievedChunks.length; i++) {
    const chunkId = String(retrievedChunks[i].id || retrievedChunks[i]._id || retrievedChunks[i].documentId || '').toLowerCase().trim();
    if (refSet.has(chunkId)) {
      firstRank = i + 1;
      break;
    }
  }

  const score = firstRank ? Math.round((1.0 / firstRank) * 1000) / 1000 : 0.0;

  return {
    name: 'mrr',
    score,
    status: score >= 0.5 ? 'passed' : 'failed',
    method: 'reciprocal_rank',
    inputsUsed: ['retrievedChunks', 'referenceContextIds'],
    reason: firstRank ? `First relevant chunk found at rank ${firstRank} (MRR: ${score})` : 'No relevant chunk retrieved',
    details: { firstRank, totalRetrieved: retrievedChunks.length },
    isDeterministic: true,
    isReferenceBased: true,
  };
}

/**
 * Computes nDCG@K (Normalized Discounted Cumulative Gain at rank K).
 * DCG = sum_{i=1}^K (2^{rel_i} - 1) / log2(i + 1)
 * IDCG = ideal DCG with sorted relevance scores.
 * 
 * @param {object} params
 * @param {Array<object>} params.retrievedChunks
 * @param {Array<string>} [params.referenceContextIds]
 * @param {object} [params.relevanceScores] - Optional map of chunkId -> relevance label (e.g. 0 to 3)
 * @param {number} [params.k=4]
 * @returns {object} Metric result
 */
export function ndcgAtK({
  retrievedChunks = [],
  referenceContextIds = [],
  relevanceScores = null,
  k = 4,
} = {}) {
  if (!Array.isArray(referenceContextIds) || referenceContextIds.length === 0) {
    return {
      name: `ndcg_at_${k}`,
      score: null,
      status: 'skipped',
      method: 'reference_based',
      inputsUsed: ['retrievedChunks'],
      reason: 'No reference context IDs available for nDCG calculation',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  const refSet = new Set(referenceContextIds.map(id => String(id).toLowerCase().trim()));
  const topKChunks = (retrievedChunks || []).slice(0, k);

  // Compute binary or graded relevance vector
  const rels = topKChunks.map(chunk => {
    const chunkId = String(chunk.id || chunk._id || chunk.documentId || '').toLowerCase().trim();
    if (relevanceScores && relevanceScores[chunkId] !== undefined) {
      return Number(relevanceScores[chunkId]);
    }
    return refSet.has(chunkId) ? 1.0 : 0.0;
  });

  // DCG calculation
  let dcg = 0.0;
  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i];
    dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2); // i+2 because 1-indexed (rank 1 -> log2(2))
  }

  // Ideal DCG
  const idealRels = [...rels].sort((a, b) => b - a);
  let idcg = 0.0;
  for (let i = 0; i < idealRels.length; i++) {
    const rel = idealRels[i];
    idcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  }

  if (idcg === 0.0) {
    return {
      name: `ndcg_at_${k}`,
      score: 0.0,
      status: 'failed',
      method: 'ndcg_formula',
      inputsUsed: ['retrievedChunks', 'referenceContextIds'],
      reason: 'No relevant chunks present in candidate pool; IDCG is 0',
      details: { k, dcg: 0, idcg: 0 },
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  const score = Math.round((dcg / idcg) * 1000) / 1000;

  return {
    name: `ndcg_at_${k}`,
    score,
    status: score >= 0.7 ? 'passed' : 'failed',
    method: 'ndcg_formula',
    inputsUsed: ['retrievedChunks', 'referenceContextIds'],
    reason: `nDCG@${k} = ${score} (DCG: ${dcg.toFixed(3)}, IDCG: ${idcg.toFixed(3)})`,
    details: { k, dcg: Math.round(dcg * 1000) / 1000, idcg: Math.round(idcg * 1000) / 1000, rels },
    isDeterministic: true,
    isReferenceBased: true,
  };
}

/**
 * Computes Context Relevance.
 * Measures lexical and semantic query-to-context relevance independently of the generated answer.
 * 
 * @param {object} params
 * @param {string} params.question
 * @param {Array<object>} params.retrievedChunks
 * @returns {object} Metric result
 */
export function contextRelevance({
  question = '',
  retrievedChunks = [],
} = {}) {
  const normQ = normalizeText(question);
  const qTokens = normQ.split(' ').filter(w => w.length > 2 && !['what', 'when', 'where', 'which', 'who', 'how'].includes(w));

  if (qTokens.length === 0 || !Array.isArray(retrievedChunks) || retrievedChunks.length === 0) {
    return {
      name: 'context_relevance',
      score: retrievedChunks.length === 0 ? 0.0 : null,
      status: retrievedChunks.length === 0 ? 'failed' : 'skipped',
      method: 'query_context_alignment',
      inputsUsed: ['question', 'retrievedChunks'],
      reason: retrievedChunks.length === 0 ? 'No chunks retrieved' : 'Question contains no evaluatable content tokens',
      isDeterministic: true,
      isReferenceBased: false,
    };
  }

  const scores = [];
  for (const chunk of retrievedChunks) {
    const chunkText = normalizeText(chunk.content || '');
    const matchedTokens = qTokens.filter(t => chunkText.includes(t));
    const tokenRatio = matchedTokens.length / qTokens.length;
    scores.push(tokenRatio);
  }

  // Rank-weighted relevance: top-ranked chunks have higher influence
  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < scores.length; i++) {
    const weight = 1 / Math.log2(i + 2);
    weightedSum += scores[i] * weight;
    weightTotal += weight;
  }
  const avgScore = weightTotal > 0 ? (weightedSum / weightTotal) : 0;
  const score = Math.round(avgScore * 1000) / 1000;

  return {
    name: 'context_relevance',
    score,
    status: score >= 0.35 ? 'passed' : 'failed',
    method: 'rank_weighted_token_alignment',
    inputsUsed: ['question', 'retrievedChunks'],
    reason: `Rank-weighted query token overlap with retrieved chunks: ${Math.round(score * 100)}%`,
    details: { totalChunks: retrievedChunks.length, chunkScores: scores },
    isDeterministic: true,
    isReferenceBased: false,
  };
}

/**
 * Computes Noise Sensitivity.
 * Evaluates whether irrelevant or distracting context causes degradation between clean and noisy conditions.
 * Score range: 0 (completely unaffected by noise, desirable) to 1 (highly degraded by noise).
 * 
 * @param {object} params
 * @param {object} params.cleanResult - Answer and confidence under clean context
 * @param {object} params.noisyResult - Answer and confidence when distracting chunks added
 * @param {string} [params.referenceAnswer]
 * @returns {object} Metric result
 */
export function noiseSensitivity({
  cleanResult = null,
  noisyResult = null,
  referenceAnswer = null,
} = {}) {
  if (!cleanResult || !noisyResult) {
    return {
      name: 'noise_sensitivity',
      score: null,
      status: 'skipped',
      method: 'controlled_comparison',
      inputsUsed: ['cleanResult', 'noisyResult'],
      reason: 'Requires both cleanResult and noisyResult from controlled comparative experiment',
      isDeterministic: true,
      isReferenceBased: Boolean(referenceAnswer),
    };
  }

  const cleanAns = normalizeText(cleanResult.answer || '');
  const noisyAns = normalizeText(noisyResult.answer || '');

  // Calculate Jaccard distance between clean answer and noisy answer
  const cleanTokens = new Set(cleanAns.split(' ').filter(w => w.length > 2));
  const noisyTokens = new Set(noisyAns.split(' ').filter(w => w.length > 2));

  let unionCount = new Set([...cleanTokens, ...noisyTokens]).size;
  let intersectCount = 0;
  for (const t of cleanTokens) {
    if (noisyTokens.has(t)) intersectCount++;
  }

  const jaccardSimilarity = unionCount > 0 ? (intersectCount / unionCount) : 1.0;
  // Sensitivity is distance from stability (1 - similarity)
  const score = Math.round((1.0 - jaccardSimilarity) * 1000) / 1000;

  return {
    name: 'noise_sensitivity',
    score,
    status: score <= 0.35 ? 'passed' : 'failed', // Low noise sensitivity is desirable
    method: 'controlled_jaccard_divergence',
    inputsUsed: ['cleanResult', 'noisyResult'],
    reason: `Noise perturbation caused ${Math.round(score * 100)}% answer divergence (Threshold <= 35%)`,
    details: {
      cleanLength: cleanAns.length,
      noisyLength: noisyAns.length,
      jaccardSimilarity: Math.round(jaccardSimilarity * 100) / 100,
    },
    isDeterministic: true,
    isReferenceBased: false,
  };
}
