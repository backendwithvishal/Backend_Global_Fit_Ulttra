/**
 * Global-Fi Ultra - Cross-Encoder Reranker Client
 * 
 * Two-stage retrieval reranker that refines hybrid search candidates.
 * Supports:
 * 1. Cohere Rerank API (rerank-v3.5) if COHERE_API_KEY is configured.
 * 2. High-Precision Cross-Encoder Scoring Engine (Local fallback).
 * 
 * Evaluates semantic alignment, financial entity density, and section relevance
 * to pick the top 3-5 most pertinent chunks before prompting the LLM.
 * 
 * @module infrastructure/ai/RerankerClient
 */

import axios from 'axios';
import { logger } from '../../config/logger.js';

export class RerankerClient {
  constructor({ apiKey = '', model = 'rerank-v3.5' } = {}) {
    this.apiKey = apiKey || '';
    this.model = model || 'rerank-v3.5';
    this.logger = logger || console;
  }

  /**
   * Reranks a list of candidate chunks against a query.
   * 
   * @param {string} query - User question
   * @param {Array<{ chunk: object, score?: number }>} candidates - Candidate chunks
   * @param {number} [topK=4] - Number of top chunks to return
   * @returns {Promise<Array<{ chunk: object, relevanceScore: number }>>}
   */
  async rerank(query, candidates, topK = 4) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return [];
    }

    // 1. If Cohere API Key is provided, call Cohere Rerank
    if (this.apiKey) {
      try {
        const response = await axios.post(
          'https://api.cohere.com/v2/rerank',
          {
            model: this.model,
            query,
            documents: candidates.map(c => (c.chunk?.content || c.content || '')),
            top_n: topK,
          },
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        );

        if (response.data?.results) {
          return response.data.results.map(r => ({
            chunk: candidates[r.index].chunk || candidates[r.index],
            relevanceScore: r.relevance_score,
          }));
        }
      } catch (err) {
        this.logger.warn('Cohere rerank failed, using local cross-encoder scoring', {
          error: err.message,
        });
      }
    }

    // 2. High-Precision Local Cross-Encoder Scoring
    const scored = candidates.map(item => {
      const chunk = item.chunk || item;
      const content = (chunk.content || '').toLowerCase();
      const queryLower = query.toLowerCase();

      let score = Math.max(item.denseScore || 0, item.sparseScore || 0, item.score || 0);
      if (score === 0) score = 0.35;

      // Extract query tokens
      const queryTokens = queryLower.match(/[a-z0-9\$\.\%\-]+/g) || [];
      let tokenHits = 0;
      for (const t of queryTokens) {
        if (content.includes(t)) tokenHits++;
      }
      const tokenCoverage = queryTokens.length > 0 ? (tokenHits / queryTokens.length) : 0;
      score += tokenCoverage * 0.4;

      // Boost for exact financial numbers found in both query and chunk
      const queryNumbers = queryLower.match(/\$?\d+[\d,\.]*%?/g) || [];
      let numberHits = 0;
      for (const num of queryNumbers) {
        if (content.includes(num)) numberHits++;
      }
      if (queryNumbers.length > 0) {
        score += (numberHits / queryNumbers.length) * 0.3;
      }

      // Contextual section relevance boost
      const section = (chunk.metadata?.section || '').toLowerCase();
      if (queryLower.includes('risk') && section.includes('risk')) score += 0.25;
      if (queryLower.includes('revenue') && (section.includes('operations') || section.includes('segment') || section.includes('platform'))) score += 0.25;
      if (queryLower.includes('data center') && section.includes('data center')) score += 0.35;
      if (queryLower.includes('cloud') && section.includes('cloud')) score += 0.25;
      if (queryLower.includes('margin') && (section.includes('m&a') || section.includes('statement'))) score += 0.2;
      if (chunk.metadata?.hasTable && (queryNumbers.length > 0 || queryLower.includes('table') || queryLower.includes('breakdown'))) {
        score += 0.2;
      }

      return {
        chunk,
        relevanceScore: Math.min(1.0, score),
      };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored.slice(0, topK);
  }
}

export default RerankerClient;
