/**
 * Global-Fi Ultra - High-Precision BM25 Lexical Retriever
 * 
 * Production Okapi BM25 implementation designed specifically for financial filings:
 * 1. Term Frequency (TF) saturation with configurable k1 (default: 1.2)
 * 2. Document Length normalization with configurable b (default: 0.75)
 * 3. Inverse Document Frequency (IDF) with Robertson-Spärck Jones smoothing
 * 4. Exact ticker (AAPL, MSFT) and financial metric ($XX.XXB, %) boosting
 * 5. Full support for document metadata filtering (symbol, filingType, tenant access)
 * 
 * @module infrastructure/vector/BM25Retriever
 */

export class BM25Retriever {
  constructor({ k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.stopWords = new Set([
      'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
      'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
      'could', 'did', 'do', 'does', 'doing', 'down', 'during',
      'each', 'few', 'for', 'from', 'further',
      'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
      'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
      'me', 'more', 'most', 'my', 'myself',
      'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
      'same', 'she', 'should', 'so', 'some', 'such',
      'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
      'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your'
    ]);
  }

  /**
   * Tokenizes and normalizes text for BM25 indexing and querying.
   * Preserves currency signs, percentages, numbers, and ticker symbols.
   * @param {string} text 
   * @returns {string[]}
   */
  tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    const rawTokens = text.toLowerCase().match(/[a-z0-9$.%-]+/g) || [];
    return rawTokens.filter(t => t.length > 1 && !this.stopWords.has(t));
  }

  /**
   * Calculates Inverse Document Frequency (IDF) for a term.
   * Uses Robertson-Spärck Jones formula with floor to prevent negative weights.
   * @param {number} docFreq - Number of documents containing the term
   * @param {number} totalDocs - Total documents in corpus
   * @returns {number}
   */
  calculateIDF(docFreq, totalDocs) {
    if (totalDocs === 0) return 0;
    const numerator = totalDocs - docFreq + 0.5;
    const denominator = docFreq + 0.5;
    return Math.max(0.1, Math.log(1 + numerator / denominator));
  }

  /**
   * Searches a collection of candidate document chunks using Okapi BM25 scoring.
   * 
   * @param {string} queryText - Query string
   * @param {Array<object>} documents - Candidate chunk objects ({ _id, content, metadata, ... })
   * @param {object} options - Search options (limit, filter)
   * @returns {Array<{ chunk: object, score: number }>} Sorted results with normalized BM25 score
   */
  search(queryText, documents, options = {}) {
    const { limit = 20, filter = null } = options;

    if (!Array.isArray(documents) || documents.length === 0) {
      return [];
    }

    // 1. Filter candidates if filter predicate is provided
    let candidatePool = documents;
    if (filter) {
      candidatePool = documents.filter(doc => {
        const meta = doc.metadata || {};
        if (filter.symbol && filter.symbol !== 'ALL' && meta.symbol !== filter.symbol) {
          return false;
        }
        if (filter.filingType && filter.filingType !== 'ALL' && meta.filingType !== filter.filingType) {
          return false;
        }
        if (filter.organizationId) {
          const orgMatch = meta.organizationId && meta.organizationId.toString() === filter.organizationId.toString();
          const publicMatch = meta.isPublic === true;
          if (!orgMatch && !publicMatch) return false;
        } else if (filter.isPublic !== undefined && meta.isPublic !== filter.isPublic) {
          return false;
        }
        return true;
      });
    }

    if (candidatePool.length === 0) {
      return [];
    }

    const queryTokens = this.tokenize(queryText);
    if (queryTokens.length === 0) {
      return [];
    }

    // 2. Compute document lengths and term frequencies across the candidate pool
    const totalDocs = candidatePool.length;
    let totalLength = 0;
    const docTokenMaps = new Array(totalDocs);
    const docLengths = new Array(totalDocs);
    const termDocFreq = new Map();

    for (let i = 0; i < totalDocs; i++) {
      const doc = candidatePool[i];
      const tokens = this.tokenize(doc.content || '');
      const tokenMap = new Map();

      for (const t of tokens) {
        tokenMap.set(t, (tokenMap.get(t) || 0) + 1);
      }

      for (const t of tokenMap.keys()) {
        termDocFreq.set(t, (termDocFreq.get(t) || 0) + 1);
      }

      docLengths[i] = tokens.length;
      totalLength += tokens.length;
      docTokenMaps[i] = tokenMap;
    }

    const avgdl = totalDocs > 0 ? (totalLength / totalDocs) : 1;

    // 3. Compute BM25 scores
    const scored = [];

    // Financial signal boosts
    const isTicker = (t) => /^[a-z]{1,5}$/.test(t) && t.length <= 4;
    const isFinancialMetric = (t) => /^\$?\d+[\d,.]*%?$/.test(t);

    for (let i = 0; i < totalDocs; i++) {
      const doc = candidatePool[i];
      const tokenMap = docTokenMaps[i];
      const docLen = docLengths[i];
      let bm25Score = 0;

      for (const queryTerm of queryTokens) {
        const tf = tokenMap.get(queryTerm) || 0;
        if (tf === 0) continue;

        const df = termDocFreq.get(queryTerm) || 0;
        const idf = this.calculateIDF(df, totalDocs);

        // Standard BM25 term weighting
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / avgdl));
        let termScore = idf * (numerator / denominator);

        // Boost for exact tickers and exact monetary numbers
        if (isTicker(queryTerm)) termScore *= 1.8;
        if (isFinancialMetric(queryTerm)) termScore *= 1.5;

        bm25Score += termScore;
      }

      if (bm25Score > 0) {
        scored.push({
          chunk: doc,
          score: bm25Score,
        });
      }
    }

    if (scored.length === 0) {
      return [];
    }

    // 4. Sort and normalize scores (0.0 to 1.0)
    scored.sort((a, b) => b.score - a.score);
    const maxScore = scored[0].score || 1;

    return scored.slice(0, limit).map(item => ({
      chunk: item.chunk,
      score: Math.min(1.0, item.score / maxScore),
    }));
  }
}

export default BM25Retriever;
