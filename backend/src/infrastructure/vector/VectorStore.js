/**
 * Global-Fi Ultra - Vector Store & Hybrid Search Engine
 * 
 * Production vector storage and retrieval manager supporting:
 * 1. MongoDB Atlas Vector Search ($vectorSearch aggregation)
 * 2. Native Resilient Vector Similarity Engine (Mongoose pipeline / cosine similarity)
 * 3. Sparse Keyword / BM25 Search (Exact ticker matching, numbers, headings)
 * 4. Reciprocal Rank Fusion (RRF) for Hybrid Relevance
 * 5. Multi-Tenant Security & Metadata Filtering
 * 
 * @module infrastructure/vector/VectorStore
 */

import { DocumentChunk } from '../../models/DocumentChunk.js';
import { EmbeddingClient } from '../ai/EmbeddingClient.js';
import { AI_CONFIG } from '../ai/aiConfig.js';
import { logger } from '../../config/logger.js';

export class VectorStore {
  constructor({ documentChunkModel = DocumentChunk, config = AI_CONFIG.rag } = {}) {
    this.model = documentChunkModel;
    this.config = config || AI_CONFIG.rag || {};
    this.logger = logger || console;
    this.atlasSearchAvailable = false;
  }

  /**
   * Builds Mongoose query filter from user options.
   */
  _buildFilter({ symbol, filingType, organizationId, isPublic = true, dateRange } = {}) {
    const filter = {};

    if (symbol && symbol !== 'ALL' && symbol !== 'GENERAL') {
      filter['metadata.symbol'] = symbol.toUpperCase().trim();
    }

    if (filingType && filingType !== 'ALL') {
      filter['metadata.filingType'] = filingType.toUpperCase().trim();
    }

    // Multi-tenant isolation
    if (organizationId) {
      filter.$or = [
        { 'metadata.organizationId': organizationId },
        { 'metadata.isPublic': true },
      ];
    } else if (isPublic !== undefined) {
      filter['metadata.isPublic'] = isPublic;
    }

    // Date range filtering
    if (dateRange && (dateRange.from || dateRange.to)) {
      filter['metadata.filingDate'] = {};
      if (dateRange.from) filter['metadata.filingDate'].$gte = new Date(dateRange.from);
      if (dateRange.to) filter['metadata.filingDate'].$lte = new Date(dateRange.to);
    }

    return filter;
  }

  /**
   * Executes Dense Semantic Vector Search.
   * 
   * @param {number[]} queryEmbedding - Target embedding vector
   * @param {object} options - Search options (filter, limit)
   * @returns {Promise<Array<{ chunk: object, score: number }>>}
   */
  async searchDense(queryEmbedding, options = {}) {
    const { filter = {}, limit = 20 } = options;

    // Check if MongoDB Atlas Vector Search can be run
    if (this.atlasSearchAvailable) {
      try {
        const pipeline = [
          {
            $vectorSearch: {
              index: 'vector_index',
              path: 'embedding',
              queryVector: queryEmbedding,
              numCandidates: limit * 5,
              limit,
              filter: filter,
            }
          },
          {
            $project: {
              content: 1,
              metadata: 1,
              chunkIndex: 1,
              documentId: 1,
              score: { $meta: 'vectorSearchScore' }
            }
          }
        ];

        const results = await this.model.aggregate(pipeline);
        return results.map(doc => ({
          chunk: doc,
          score: doc.score || 0,
        }));
      } catch (err) {
        // Fall back to native exact vector search if Atlas Vector Search is not enabled on cluster
        this.atlasSearchAvailable = false;
        this.logger.debug('Atlas Vector Search not active, using native similarity search', { error: err.message });
      }
    }

    // Native Exact Vector Cosine Similarity Search
    const candidates = await this.model.find(filter)
      .select('content metadata chunkIndex documentId embedding')
      .lean()
      .limit(200);

    const scored = [];
    for (const doc of candidates) {
      const similarity = EmbeddingClient.cosineSimilarity(queryEmbedding, doc.embedding);
      scored.push({
        chunk: {
          _id: doc._id,
          content: doc.content,
          metadata: doc.metadata,
          chunkIndex: doc.chunkIndex,
          documentId: doc.documentId,
        },
        score: similarity,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Executes Sparse Keyword / BM25 Search.
   * 
   * @param {string} queryText - User question
   * @param {object} options - Search options (filter, limit)
   * @returns {Promise<Array<{ chunk: object, score: number }>>}
   */
  async searchSparse(queryText, options = {}) {
    const { filter = {}, limit = 20 } = options;

    // Extract key tokens (e.g., AAPL, revenue, growth, 2024, margin)
    const tokens = (queryText.match(/[a-zA-Z0-9\$\%]+/g) || [])
      .filter(t => t.length >= 2);

    if (tokens.length === 0) {
      return [];
    }

    try {
      // 1. Try MongoDB Text Index Search first
      const textQuery = {
        ...filter,
        $text: { $search: queryText }
      };

      const textMatches = await this.model.find(textQuery, { score: { $meta: 'textScore' } })
        .select('content metadata chunkIndex documentId')
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .lean();

      if (textMatches.length > 0) {
        const maxScore = textMatches[0].score || 1;
        return textMatches.map(doc => ({
          chunk: doc,
          score: (doc.score || 0) / maxScore, // Normalize between 0 and 1
        }));
      }
    } catch {
      // If text index is not yet built, fallback to regex token matching
    }

    // Regex token scoring fallback
    const regexTerms = tokens.slice(0, 5).map(t => new RegExp(t, 'i'));
    const regexQuery = {
      ...filter,
      content: { $in: regexTerms }
    };

    const matches = await this.model.find(regexQuery)
      .select('content metadata chunkIndex documentId')
      .limit(limit * 2)
      .lean();

    const scored = matches.map(doc => {
      let hits = 0;
      const lower = doc.content.toLowerCase();
      for (const t of tokens) {
        if (lower.includes(t.toLowerCase())) hits++;
      }
      return {
        chunk: doc,
        score: Math.min(1, hits / tokens.length),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Hybrid Search: Combines Dense Vector + Sparse Keyword with Reciprocal Rank Fusion (RRF).
   * 
   * @param {object} params
   * @param {number[]} params.queryEmbedding
   * @param {string} params.queryText
   * @param {object} [params.filterOptions]
   * @param {number} [params.limit=5]
   * @returns {Promise<Array<{ chunk: object, denseScore: number, sparseScore: number, rrfScore: number }>>}
   */
  async hybridSearch({
    queryEmbedding,
    queryText,
    filterOptions = {},
    limit = 5,
  }) {
    const filter = this._buildFilter(filterOptions);
    const candidateLimit = this.config.retrieval?.initialCandidates || 20;

    // Run Dense and Sparse search in parallel
    const [denseResults, sparseResults] = await Promise.all([
      this.searchDense(queryEmbedding, { filter, limit: candidateLimit }),
      this.searchSparse(queryText, { filter, limit: candidateLimit }),
    ]);

    const rrfConstant = this.config.retrieval?.rrfConstant || 60;
    const denseWeight = this.config.retrieval?.denseWeight || 0.65;
    const sparseWeight = this.config.retrieval?.sparseWeight || 0.35;

    // Fusion map by chunk _id string
    const fusionMap = new Map();

    // Dense rank contribution
    denseResults.forEach((item, rank) => {
      const id = item.chunk._id.toString();
      const rrfContribution = denseWeight / (rrfConstant + (rank + 1));

      fusionMap.set(id, {
        chunk: item.chunk,
        denseScore: item.score,
        sparseScore: 0,
        rrfScore: rrfContribution,
      });
    });

    // Sparse rank contribution
    sparseResults.forEach((item, rank) => {
      const id = item.chunk._id.toString();
      const rrfContribution = sparseWeight / (rrfConstant + (rank + 1));

      if (fusionMap.has(id)) {
        const existing = fusionMap.get(id);
        existing.sparseScore = item.score;
        existing.rrfScore += rrfContribution;
      } else {
        fusionMap.set(id, {
          chunk: item.chunk,
          denseScore: 0,
          sparseScore: item.score,
          rrfScore: rrfContribution,
        });
      }
    });

    // Sort by merged RRF score
    const merged = Array.from(fusionMap.values());
    merged.sort((a, b) => b.rrfScore - a.rrfScore);

    return merged.slice(0, limit);
  }
}

export default VectorStore;
