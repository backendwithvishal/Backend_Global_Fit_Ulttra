/**
 * Global_Fit_Ulttra - Financial Specific Correctness Metrics
 * 
 * Strict deterministic financial evaluation metrics:
 * 1. Numerical Accuracy: Monetary values, percentages, scales, accounting notation, explicit tolerance
 * 2. Financial Entity Accuracy: Tickers, companies, periods, metrics, and their associations
 * 3. Abstention & Insufficient Evidence Accuracy: Verification of safe refusal vs false refusal vs hallucination
 * 
 * @module evaluation/metrics/FinancialMetrics
 */

function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  // Strip thousands commas so $39,296 becomes $39296 instead of splitting into $39 296
  const cleanCommas = text.replace(/(\d),(\d)/g, '$1$2');
  return cleanCommas.toLowerCase().replace(/[^a-z0-9$%.\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export const CURRENCY_SYNONYMS = {
  USD: ['$', 'usd', 'dollar', 'dollars'],
  EUR: ['€', 'eur', 'euro', 'euros'],
  GBP: ['£', 'gbp', 'pound', 'pounds'],
  JPY: ['¥', 'jpy', 'yen'],
};

export function isRefusalResponse(resultOrText) {
  const text = typeof resultOrText === 'string' ? resultOrText : (resultOrText?.answer || '');
  const norm = normalizeText(text);
  const retrievalCount = typeof resultOrText === 'object' ? (resultOrText.retrievalCount || 0) : null;
  const confidence = typeof resultOrText === 'object' ? (resultOrText.confidence || 0) : null;

  return (
    norm.includes('do not contain sufficient') ||
    norm.includes('insufficient evidence') ||
    norm.includes('cannot be verified') ||
    norm.includes('restricted') ||
    norm.includes('no matching financial') ||
    norm.includes('below safety threshold') ||
    norm.includes('cannot be guaranteed') ||
    (retrievalCount === 0 && confidence !== null && confidence < 50)
  );
}

/**
 * Parses financial numeric values with scale multipliers and accounting signs.
 * Handles:
 * - $39,296 million -> 39296000000
 * - $245.1 billion -> 245100000000
 * - $85.78 billion vs $85,777 million -> equivalent within tolerance
 * - 46.3% -> 0.463 (or 46.3)
 * - (1%) or -1% -> negative percentage
 */
export function parseFinancialNumber(valStr) {
  if (typeof valStr === 'number') {
    return { value: valStr, isPercentage: false, raw: String(valStr) };
  }
  if (!valStr || typeof valStr !== 'string') return null;

  const raw = valStr.trim();
  let clean = raw.replace(/[$,]/g, '').trim();

  // Accounting parenthesis check: (1%) or (39,296) -> negative
  let isNegative = false;
  if (/^\(.*\)$/.test(clean)) {
    isNegative = true;
    clean = clean.replace(/[()]/g, '').trim();
  } else if (clean.startsWith('-')) {
    isNegative = true;
    clean = clean.slice(1).trim();
  }

  // Percentage check
  let isPercentage = false;
  if (clean.endsWith('%') || /percent/i.test(clean)) {
    isPercentage = true;
    clean = clean.replace(/%|percent/gi, '').trim();
  }

  // Scale multipliers
  let multiplier = 1;
  if (/\b(b|billion|bn)\b/i.test(clean)) {
    multiplier = 1e9;
    clean = clean.replace(/\b(b|billion|bn)\b/gi, '').trim();
  } else if (/\b(m|million|mn)\b/i.test(clean)) {
    multiplier = 1e6;
    clean = clean.replace(/\b(m|million|mn)\b/gi, '').trim();
  } else if (/\b(k|thousand)\b/i.test(clean)) {
    multiplier = 1e3;
    clean = clean.replace(/\b(k|thousand)\b/gi, '').trim();
  }

  const num = parseFloat(clean);
  if (isNaN(num)) return null;

  const baseValue = num * multiplier;
  const finalValue = isNegative ? -baseValue : baseValue;

  return {
    value: finalValue,
    isPercentage,
    raw,
  };
}

/**
 * Computes Numerical Accuracy.
 * Strictly verifies monetary amounts, growth percentages, margins, and ratios.
 * Allows safe explicit tolerance (default 1.0% / 0.01) for rounded representations (e.g. 85.78B vs 85,777M),
 * but strictly fails mismatched orders of magnitude, wrong signs, or wrong numbers.
 * 
 * @param {object} params
 * @param {string} params.generatedAnswer
 * @param {Array<object|string|number>} params.expectedFinancialValues
 * @param {number} [params.tolerance=0.015] - 1.5% tolerance for rounded financial figures
 * @returns {object} Metric result
 */
export function numericalAccuracy({
  generatedAnswer = '',
  expectedFinancialValues = [],
  tolerance = 0.015,
} = {}) {
  if (!Array.isArray(expectedFinancialValues) || expectedFinancialValues.length === 0) {
    return {
      name: 'numerical_accuracy',
      score: null,
      status: 'skipped',
      method: 'deterministic_financial_parser',
      inputsUsed: ['generatedAnswer'],
      reason: 'No expected financial values provided in dataset record',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  const normAnswer = normalizeText(generatedAnswer);
  const evaluations = [];
  let matchedCount = 0;

  for (const expected of expectedFinancialValues) {
    const expectedRaw = typeof expected === 'object' ? (expected.value || expected.raw) : expected;
    const expectedParsed = parseFinancialNumber(String(expectedRaw));

    let found = false;
    let reason = '';

    if (!expectedParsed) {
      // Fallback to literal string match
      const cleanLiteral = normalizeText(String(expectedRaw));
      found = normAnswer.includes(cleanLiteral);
      reason = found ? 'Literal match found' : 'Literal value not found in answer';
    } else {
      // 1. First check if the exact string or normalized string is present
      const cleanLiteral = normalizeText(String(expectedRaw)).replace(/,/g, '');
      if (normAnswer.replace(/,/g, '').includes(cleanLiteral)) {
        found = true;
        reason = `Exact representation '${expectedRaw}' found in text`;
      } else {
        // 2. Scan answer for candidate financial numbers and test numerical proximity
        const candidateMatches = generatedAnswer.match(
          /[-$]?\(?\d+(?:,\d{3})*(?:\.\d+)?\)?(?:\s*(?:%|percent|billion|million|thousand|b|m|k|points))?/gi
        ) || [];

        for (const candidate of candidateMatches) {
          const parsedCandidate = parseFinancialNumber(candidate);
          if (!parsedCandidate) continue;

          // Percentage must match percentage
          if (expectedParsed.isPercentage !== parsedCandidate.isPercentage) continue;

          // Check relative tolerance
          const expVal = expectedParsed.value;
          const candVal = parsedCandidate.value;
          const absDiff = Math.abs(expVal - candVal);
          const relativeDiff = Math.abs(expVal) > 0 ? (absDiff / Math.abs(expVal)) : absDiff;

          if (relativeDiff <= tolerance) {
            found = true;
            reason = `Normalized value ${candVal} matched expected ${expVal} within ${tolerance * 100}% tolerance`;
            break;
          }
        }

        if (!found) {
          reason = `Expected ${expectedRaw} (value: ${expectedParsed.value}) not found within tolerance`;
        }
      }
    }

    if (found) matchedCount++;

    evaluations.push({
      expected: expectedRaw,
      found,
      reason,
    });
  }

  const score = Math.round((matchedCount / expectedFinancialValues.length) * 1000) / 1000;

  return {
    name: 'numerical_accuracy',
    score,
    status: score === 1.0 ? 'passed' : 'failed', // Strict: Financial numbers should be 100% accurate
    method: 'deterministic_financial_parser',
    inputsUsed: ['generatedAnswer', 'expectedFinancialValues'],
    reason: `${matchedCount}/${expectedFinancialValues.length} financial numbers verified accurately (${Math.round(score * 100)}%)`,
    details: {
      tolerance,
      totalExpected: expectedFinancialValues.length,
      matchedCount,
      evaluations,
    },
    isDeterministic: true,
    isReferenceBased: true,
  };
}

/**
 * Computes Financial Entity Accuracy.
 * Verifies that financial entities (tickers, company names, reporting periods, metric names)
 * are accurately stated and not cross-attributed to wrong companies or periods.
 * 
 * @param {object} params
 * @param {string} params.generatedAnswer
 * @param {Array<object|string>} params.expectedEntities
 * @param {string} [params.expectedReportingPeriod]
 * @param {string} [params.expectedCurrency]
 * @returns {object} Metric result
 */
export function financialEntityAccuracy({
  generatedAnswer = '',
  expectedEntities = [],
  expectedReportingPeriod = null,
  expectedCurrency = null,
  expectedBehavior = 'ANSWER',
} = {}) {
  if (expectedBehavior === 'REFUSE' || expectedBehavior === 'SECURITY_ISOLATION') {
    return {
      name: 'financial_entity_accuracy',
      score: null,
      status: 'not_applicable',
      method: 'deterministic_entity_matcher',
      inputsUsed: ['generatedAnswer'],
      reason: 'Negative/unanswerable test query: entity absence expected in refusal response',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  const normAnswer = normalizeText(generatedAnswer);
  const entitiesToCheck = [...(expectedEntities || [])];

  if (expectedReportingPeriod) {
    entitiesToCheck.push({ type: 'PERIOD', value: expectedReportingPeriod });
  }
  if (expectedCurrency) {
    entitiesToCheck.push({ type: 'CURRENCY', value: expectedCurrency });
  }

  if (entitiesToCheck.length === 0) {
    return {
      name: 'financial_entity_accuracy',
      score: null,
      status: 'skipped',
      method: 'deterministic_entity_matcher',
      inputsUsed: ['generatedAnswer'],
      reason: 'No expected financial entities or reporting periods supplied',
      isDeterministic: true,
      isReferenceBased: true,
    };
  }

  let matched = 0;
  const entityResults = [];

  for (const ent of entitiesToCheck) {
    const rawVal = typeof ent === 'string' ? ent : (ent.value || ent.name || '');
    const cleanVal = normalizeText(rawVal);
    let found = false;

    if (ent.type === 'CURRENCY' || rawVal.toUpperCase() in CURRENCY_SYNONYMS) {
      const syns = CURRENCY_SYNONYMS[rawVal.toUpperCase()] || [cleanVal];
      found = syns.some(s => normAnswer.includes(s));
    } else {
      found = normAnswer.includes(cleanVal);
    }

    if (found) matched++;

    entityResults.push({
      entity: rawVal,
      type: ent.type || 'ENTITY',
      found,
    });
  }

  const score = Math.round((matched / entitiesToCheck.length) * 1000) / 1000;

  return {
    name: 'financial_entity_accuracy',
    score,
    status: score >= 0.85 ? 'passed' : 'failed',
    method: 'deterministic_entity_matcher',
    inputsUsed: ['generatedAnswer', 'expectedEntities'],
    reason: `${matched}/${entitiesToCheck.length} financial entities accurately identified (${Math.round(score * 100)}%)`,
    details: { totalEntities: entitiesToCheck.length, matched, entityResults },
    isDeterministic: true,
    isReferenceBased: true,
  };
}

/**
 * Computes Insufficient-Evidence and Abstention Accuracy.
 * Evaluates whether the system correctly acknowledges uncertainty or refuses to answer
 * when evidence is missing, unverified, or unauthorized.
 * 
 * Prevents hallucinations on missing evidence and distinguishes correct refusal from incorrect refusal.
 * 
 * @param {object} params
 * @param {object} params.result - Full pipeline output { answer, citations, confidence, retrievalCount }
 * @param {string} params.expectedBehavior - 'ANSWER' | 'REFUSE' | 'LIVE_MARKET' | 'SECURITY_ISOLATION'
 * @returns {object} Metric result
 */
export function abstentionAccuracy({
  result = {},
  expectedBehavior = 'ANSWER',
} = {}) {
  const answer = (result.answer || '').trim();
  const isRefusal = isRefusalResponse(result);

  let score = 0.0;
  let status = 'failed';
  let reason = '';

  if (expectedBehavior === 'REFUSE' || expectedBehavior === 'SECURITY_ISOLATION') {
    if (isRefusal) {
      score = 1.0;
      status = 'passed';
      reason = 'System correctly acknowledged missing evidence and safely refused without hallucination';
    } else {
      score = 0.0;
      status = 'failed';
      reason = 'System failed to refuse when evidence was missing/unauthorized; potential hallucination or security leak';
    }
  } else {
    // Normal query expected to answer
    if (!isRefusal && answer.length > 20) {
      score = 1.0;
      status = 'passed';
      reason = 'System correctly generated grounded answer when evidence was sufficient';
    } else {
      score = 0.0;
      status = 'failed';
      reason = 'False Refusal: System refused to answer despite sufficient supporting evidence in repository';
    }
  }

  return {
    name: 'abstention_accuracy',
    score,
    status,
    method: 'behavioral_abstention_check',
    inputsUsed: ['result', 'expectedBehavior'],
    reason,
    details: {
      expectedBehavior,
      isRefusal,
      answerLength: answer.length,
      confidence: result.confidence || 0,
      retrievalCount: result.retrievalCount || 0,
    },
    isDeterministic: true,
    isReferenceBased: true,
  };
}
