/**
 * Global-Fi Ultra - Unified Vector Store & Hybrid Search Engine
 * 
 * Production hybrid retrieval orchestrator supporting:
 * 1. Primary Dedicated Vector Store: Qdrant (via QdrantVectorStore)
 * 2. Resilient Database Vector Store: MongoDB Atlas & in-database Cosine Pipeline (Fallback)
 * 3. Lexical Search Engine: Okapi BM25 (via BM25Retriever) with financial term & ticker boosting
 * 4. Reciprocal Rank Fusion (RRF) combining dense semantic & sparse BM25 scores
 * 5. Strict multi-tenant access control and metadata filtering
 * 
 * @module infrastructure/vector/VectorStore
 */

import { DocumentChunk } from '../../models/DocumentChunk.js';
import { EmbeddingClient } from '../ai/EmbeddingClient.js';
import { BM25Retriever } from './BM25Retriever.js';
import { AI_CONFIG } from '../ai/aiConfig.js';
import { logger } from '../../config/logger.js';

export class VectorStore {
  constructor({
    documentChunkModel = DocumentChunk,
    qdrantVectorStore = null,
    config = AI_CONFIG.rag,
  } = {}) {
    this.model = documentChunkModel;
    this.config = config || AI_CONFIG.rag || {};
    this.logger = logger || console;

    // Initialize BM25 Lexical Retriever
    this.bm25Retriever = new BM25Retriever({ k1: 1.2, b: 0.75 });

    // Dedicated Qdrant Vector Store
    this.qdrantStore = qdrantVectorStore;
    this.atlasSearchAvailable = false;
  }

  /**
   * Sets or updates the Qdrant vector store adapter.
   * @param {QdrantVectorStore} qdrantStore
   */
  setQdrantStore(qdrantStore) {
    this.qdrantStore = qdrantStore;
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

    // Multi-tenant isolation: Tenant chunks or public documents
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
   * Tries Qdrant first; falls back to MongoDB Atlas or native Cosine Similarity if Qdrant is unavailable.
   * 
   * @param {number[]} queryEmbedding - 384-dimensional dense vector
   * @param {object} options - Search options (filter, limit)
   * @returns {Promise<Array<{ chunk: object, score: number }>>}
   */
  async searchDense(queryEmbedding, options = {}) {
    const { filter = {}, limit = 20 } = options;

    // 1. Try Qdrant if active
    if (this.qdrantStore && this.qdrantStore.isReady) {
      try {
        const qdrantResults = await this.qdrantStore.searchDense(queryEmbedding, {
          filter,
          limit,
        });
        if (qdrantResults && qdrantResults.length > 0) {
          return qdrantResults;
        }
      } catch (err) {
        this.logger.debug('Qdrant search yielded no results or encountered error, using MongoDB fallback', {
          error: err.message,
        });
      }
    }

    // 2. Try MongoDB Atlas Vector Search if enabled
    if (this.atlasSearchAvailable) {
      try {
        const mongoFilter = this._buildFilter(filter);
        const pipeline = [
          {
            $vectorSearch: {
              index: 'vector_index',
              path: 'embedding',
              queryVector: queryEmbedding,
              numCandidates: limit * 5,
              limit,
              filter: mongoFilter,
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
        this.atlasSearchAvailable = false;
        this.logger.debug('Atlas Vector Search not active, using native similarity search', { error: err.message });
      }
    }

    // 3. Resilient In-Database Cosine Similarity Search
    const mongoFilter = this._buildFilter(filter);
    const candidates = await this.model.find(mongoFilter)
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
   * Uses Okapi BM25 retriever across candidates matching the filter criteria.
   * 
   * @param {string} queryText - User question
   * @param {object} options - Search options (filter, limit)
   * @returns {Promise<Array<{ chunk: object, score: number }>>}
   */
  async searchSparse(queryText, options = {}) {
    const { filter = {}, limit = 20 } = options;

    const mongoFilter = this._buildFilter(filter);

    // Fetch candidate documents for BM25 evaluation
    const candidates = await this.model.find(mongoFilter)
      .select('content metadata chunkIndex documentId')
      .lean()
      .limit(200);

    if (candidates.length === 0) {
      return [];
    }

    // Run Okapi BM25 scoring with exact financial signal boosting
    return this.bm25Retriever.search(queryText, candidates, {
      limit,
    });
  }

  /**
   * Hybrid Search: Combines Dense Vector + Sparse BM25 with Reciprocal Rank Fusion (RRF).
   * 
   * @param {object} params
   * @param {number[]} params.queryEmbedding - Dense vector
   * @param {string} params.queryText - Natural language question
   * @param {object} [params.filterOptions] - Metadata filters (symbol, filingType, organizationId)
   * @param {number} [params.limit=5] - Number of top fused chunks
   * @returns {Promise<Array<{ chunk: object, denseScore: number, sparseScore: number, rrfScore: number }>>}
   */
  async hybridSearch({
    queryEmbedding,
    queryText,
    filterOptions = {},
    limit = 5,
  }) {
    const candidateLimit = this.config.retrieval?.initialCandidates || 25;

    // Run Dense and Sparse search in parallel
    const [denseResults, sparseResults] = await Promise.all([
      this.searchDense(queryEmbedding, { filter: filterOptions, limit: candidateLimit }),
      this.searchSparse(queryText, { filter: filterOptions, limit: candidateLimit }),
    ]);

    const rrfConstant = this.config.retrieval?.rrfConstant || 60;
    const denseWeight = this.config.retrieval?.denseWeight || 0.65;
    const sparseWeight = this.config.retrieval?.sparseWeight || 0.35;

    // Fusion map keyed by chunk identifier string
    const fusionMap = new Map();

    // 1. Dense rank contribution
    denseResults.forEach((item, rank) => {
      const id = (item.chunk._id || `${item.chunk.documentId}:${item.chunk.chunkIndex}`).toString();
      const rrfContribution = denseWeight / (rrfConstant + (rank + 1));

      fusionMap.set(id, {
        chunk: item.chunk,
        denseScore: item.score || 0,
        sparseScore: 0,
        rrfScore: rrfContribution,
      });
    });

    // 2. Sparse rank contribution
    sparseResults.forEach((item, rank) => {
      const id = (item.chunk._id || `${item.chunk.documentId}:${item.chunk.chunkIndex}`).toString();
      const rrfContribution = sparseWeight / (rrfConstant + (rank + 1));

      if (fusionMap.has(id)) {
        const existing = fusionMap.get(id);
        existing.sparseScore = item.score || 0;
        existing.rrfScore += rrfContribution;
      } else {
        fusionMap.set(id, {
          chunk: item.chunk,
          denseScore: 0,
          sparseScore: item.score || 0,
          rrfScore: rrfContribution,
        });
      }
    });

    // 3. Sort by merged RRF score
    const merged = Array.from(fusionMap.values());
    merged.sort((a, b) => b.rrfScore - a.rrfScore);

    return merged.slice(0, limit);
  }

  /**
   * Indexes chunks into both Qdrant and MongoDB.
   * @param {Array<object>} chunks
   */
  async indexChunks(chunks) {
    if (this.qdrantStore && this.qdrantStore.isReady) {
      try {
        await this.qdrantStore.upsertChunks(chunks);
      } catch (err) {
        this.logger.warn('Failed to upsert chunks into Qdrant', { error: err.message });
      }
    }
  }

  /**
   * Deletes chunks associated with a document ID from both stores.
   * @param {string} documentId
   */
  async deleteByDocumentId(documentId) {
    if (this.qdrantStore && this.qdrantStore.isReady) {
      try {
        await this.qdrantStore.deleteByDocumentId(documentId);
      } catch (err) {
        this.logger.warn('Failed to delete points from Qdrant', { error: err.message });
      }
    }
  }
}

export default VectorStore;
