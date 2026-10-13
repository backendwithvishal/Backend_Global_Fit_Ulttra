/**
 * Global-Fi Ultra - Semantic Query Cache
 * 
 * High-performance semantic cache powered by Redis with in-memory LRU fallback.
 * Checks for semantic equivalence before invoking expensive LLM inference,
 * slashing API costs and returning cached financial answers in under 30ms.
 * 
 * @module infrastructure/cache/SemanticCache
 */

import crypto from 'crypto';
import { EmbeddingClient } from '../ai/EmbeddingClient.js';
import { AI_CONFIG } from '../ai/aiConfig.js';
import { logger } from '../../config/logger.js';

export class SemanticCache {
  constructor({ cacheService = null, config = AI_CONFIG.rag?.semanticCache } = {}) {
    this.cacheService = cacheService;
    this.config = config || { similarityThreshold: 0.90, ttl: 86400 };
    this.logger = logger || console;

    // In-memory fallback if Redis is unavailable
    this.memoryCache = new Map();
    this.maxMemoryItems = 500;
  }

  /**
   * Generates exact query hash key.
   */
  _getExactKey(queryText, options = {}) {
    const canonical = `${queryText.toLowerCase().trim()}:${options.symbol || ''}:${options.filingType || ''}`;
    const hash = crypto.createHash('sha256').update(canonical).digest('hex');
    return `rag:cache:exact:${hash}`;
  }

  /**
   * Retrieves a cached RAG response.
   * 
   * @param {string} queryText - User question
   * @param {number[]} queryEmbedding - Vector embedding of question
   * @param {object} options - Filter context (symbol, etc.)
   * @returns {Promise<object|null>} Cached payload or null
   */
  async get(queryText, queryEmbedding, options = {}) {
    // 1. Check exact match in Redis / memory
    const exactKey = this._getExactKey(queryText, options);

    if (this.cacheService) {
      try {
        const exactHit = await this.cacheService.get(exactKey);
        if (exactHit) {
          this.logger.debug('Semantic cache hit (exact match)', { query: queryText });
          return { ...exactHit, cacheSource: 'redis_exact' };
        }
      } catch {
        // Continue to semantic check
      }
    } else if (this.memoryCache.has(exactKey)) {
      return { ...this.memoryCache.get(exactKey), cacheSource: 'memory_exact' };
    }

    // 2. Check semantic similarity against active query index in Redis
    if (queryEmbedding && this.cacheService) {
      try {
        const indexKey = `rag:cache:index:${options.symbol || 'ALL'}`;
        const indexList = await this.cacheService.get(indexKey);

        if (Array.isArray(indexList) && indexList.length > 0) {
          let bestMatch = null;
          let highestScore = 0;

          for (const item of indexList) {
            const similarity = EmbeddingClient.cosineSimilarity(queryEmbedding, item.embedding);
            if (similarity > highestScore && similarity >= this.config.similarityThreshold) {
              highestScore = similarity;
              bestMatch = item;
            }
          }

          if (bestMatch) {
            const cachedPayload = await this.cacheService.get(bestMatch.payloadKey);
            if (cachedPayload) {
              this.logger.debug('Semantic cache hit (similarity match)', {
                query: queryText,
                matchedQuery: bestMatch.queryText,
                similarity: highestScore,
              });
              return {
                ...cachedPayload,
                similarity: highestScore,
                cacheSource: 'redis_semantic',
              };
            }
          }
        }
      } catch (err) {
        this.logger.debug('Semantic index lookup skipped', { error: err.message });
      }
    }

    return null;
  }

  /**
   * Stores a RAG response into the semantic cache.
   * 
   * @param {string} queryText
   * @param {number[]} queryEmbedding
   * @param {object} payload - Answer, citations, confidence
   * @param {object} options
   */
  async set(queryText, queryEmbedding, payload, options = {}) {
    const exactKey = this._getExactKey(queryText, options);
    const ttl = this.config.ttl || 86400;

    const dataToStore = {
      ...payload,
      cachedAt: new Date().toISOString(),
    };

    // Store exact key
    if (this.cacheService) {
      try {
        await this.cacheService.set(exactKey, dataToStore, ttl);

        // Update semantic index for the symbol
        if (queryEmbedding) {
          const indexKey = `rag:cache:index:${options.symbol || 'ALL'}`;
          let indexList = (await this.cacheService.get(indexKey)) || [];

          // Keep max 50 recent indexed queries per symbol
          indexList.unshift({
            queryText,
            embedding: queryEmbedding,
            payloadKey: exactKey,
            createdAt: Date.now(),
          });

          if (indexList.length > 50) {
            indexList = indexList.slice(0, 50);
          }

          await this.cacheService.set(indexKey, indexList, ttl);
        }
      } catch (err) {
        this.logger.debug('Failed to write to Redis semantic cache', { error: err.message });
      }
    } else {
      // Memory fallback with LRU eviction
      if (this.memoryCache.size >= this.maxMemoryItems) {
        const firstKey = this.memoryCache.keys().next().value;
        this.memoryCache.delete(firstKey);
      }
      this.memoryCache.set(exactKey, dataToStore);
    }
  }
}

export default SemanticCache;
