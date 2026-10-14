/**
 * Global-Fi Ultra - Production Embedding Client
 * 
 * Generates genuine dense semantic embeddings supporting:
 * 1. Local Dense Semantic Transformer (Xenova/all-MiniLM-L6-v2, 384 dimensions)
 *    - Pure local Node.js execution via ONNX runtime
 *    - Zero external network dependencies, $0 cost, zero billing risk
 *    - True semantic awareness (synonyms, contextual relevance, financial phrasing)
 * 2. OpenAI Embeddings API (text-embedding-3-small, 1536 dims)
 * 3. Voyage AI Financial Embeddings (voyage-finance-2, 1024 dims)
 * 4. HuggingFace Feature Extraction API (optional)
 * 
 * Features:
 * - Redis & In-Memory SHA-256 embedding cache (30-day TTL)
 * - Parallel batch processing with bounded concurrency
 * - Resilient offline fallback
 * - L2 unit normalization for exact dot-product cosine similarity
 * 
 * @module infrastructure/ai/EmbeddingClient
 */

import crypto from 'crypto';
import axios from 'axios';
import { logger } from '../../config/logger.js';

let xenovaPipelinePromise = null;

export class EmbeddingClient {
  constructor({
    provider = 'local',
    apiKey = '',
    model = '',
    cacheService = null,
  } = {}) {
    this.provider = (provider || 'local').toLowerCase();
    this.apiKey = apiKey || '';
    this.cacheService = cacheService;
    this.logger = logger || console;

    // Set vector dimensions and default model based on provider
    if (this.provider === 'openai' && this.apiKey) {
      this.dimensions = 1536;
      this.model = model || 'text-embedding-3-small';
    } else if (this.provider === 'voyage' && this.apiKey) {
      this.dimensions = 1024;
      this.model = model || 'voyage-finance-2';
    } else if (this.provider === 'huggingface' && this.apiKey) {
      this.dimensions = 384;
      this.model = model || 'sentence-transformers/all-MiniLM-L6-v2';
    } else {
      this.provider = 'local';
      this.dimensions = 384;
      this.model = model || 'Xenova/all-MiniLM-L6-v2';
    }

    this.logger.info('EmbeddingClient initialized', {
      provider: this.provider,
      dimensions: this.dimensions,
      model: this.model,
      cacheEnabled: !!this.cacheService,
    });
  }

  /**
   * Lazily loads the local Transformer pipeline singleton.
   * Uses Xenova/all-MiniLM-L6-v2 for genuine 384-dimensional semantic embeddings.
   */
  async _getTransformerPipeline() {
    if (!xenovaPipelinePromise) {
      xenovaPipelinePromise = (async () => {
        try {
          const { pipeline } = await import('@xenova/transformers');
          const extractor = await pipeline('feature-extraction', this.model, {
            quantized: true,
          });
          this.logger.info(`✅ Local Transformer embedding pipeline loaded (${this.model})`);
          return extractor;
        } catch (err) {
          this.logger.warn('⚠️ Failed to initialize @xenova/transformers pipeline, using resilient semantic projection fallback', {
            error: err.message,
          });
          return null;
        }
      })();
    }
    return xenovaPipelinePromise;
  }

  /**
   * Generates a cache key for an input string.
   */
  _getCacheKey(text) {
    const hash = crypto.createHash('sha256').update(`${this.provider}:${this.model}:${text}`).digest('hex');
    return `rag:embedding:${hash}`;
  }

  /**
   * Generates embedding for a single text string.
   * @param {string} text 
   * @returns {Promise<number[]>}
   */
  async embedQuery(text) {
    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }

  /**
   * Generates embeddings for an array of text chunks with caching and batching.
   * @param {string[]} texts 
   * @returns {Promise<number[][]>}
   */
  async embedBatch(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    const results = new Array(texts.length);
    const missingIndices = [];
    const missingTexts = [];

    // 1. Check cache first
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (this.cacheService) {
        try {
          const cacheKey = this._getCacheKey(text);
          const cached = await this.cacheService.get(cacheKey);
          if (cached && Array.isArray(cached) && cached.length === this.dimensions) {
            results[i] = cached;
            continue;
          }
        } catch {
          // Cache miss / error: continue to generation
        }
      }
      missingIndices.push(i);
      missingTexts.push(text);
    }

    if (missingTexts.length === 0) {
      return results;
    }

    // 2. Compute missing embeddings based on provider
    let computedEmbeddings = [];
    if (this.provider === 'openai' && this.apiKey) {
      computedEmbeddings = await this._embedOpenAI(missingTexts);
    } else if (this.provider === 'voyage' && this.apiKey) {
      computedEmbeddings = await this._embedVoyage(missingTexts);
    } else if (this.provider === 'huggingface' && this.apiKey) {
      computedEmbeddings = await this._embedHuggingFace(missingTexts);
    } else {
      computedEmbeddings = await this._embedLocalTransformer(missingTexts);
    }

    // 3. Fill results and save to cache
    for (let j = 0; j < missingIndices.length; j++) {
      const originalIdx = missingIndices[j];
      const embedding = computedEmbeddings[j];
      results[originalIdx] = embedding;

      if (this.cacheService && embedding) {
        try {
          const cacheKey = this._getCacheKey(texts[originalIdx]);
          // Cache for 30 days (2592000s)
          await this.cacheService.set(cacheKey, embedding, 2592000);
        } catch {
          // Non-fatal cache write failure
        }
      }
    }

    return results;
  }

  /**
   * Local Genuine Semantic Embedding generator via @xenova/transformers.
   * @param {string[]} texts
   * @returns {Promise<number[][]>}
   */
  async _embedLocalTransformer(texts) {
    try {
      const extractor = await this._getTransformerPipeline();
      if (!extractor) {
        return this._embedFallbackProjection(texts);
      }

      const embeddings = [];
      for (const text of texts) {
        const clean = (text || '').trim() || 'financial document';
        const output = await extractor(clean, { pooling: 'mean', normalize: true });
        embeddings.push(Array.from(output.data));
      }
      return embeddings;
    } catch (err) {
      this.logger.warn('Transformer extraction failed, using resilient projection fallback', {
        error: err.message,
      });
      return this._embedFallbackProjection(texts);
    }
  }

  /**
   * Resilient deterministic dense vector projection fallback (used only if ONNX fails).
   * Generates unit-normalized 384-dimensional dense vectors.
   * @param {string[]} texts
   * @returns {number[][]}
   */
  _embedFallbackProjection(texts) {
    return texts.map(text => {
      const vector = new Float32Array(this.dimensions);
      const clean = (text || '').toLowerCase();
      const tokens = clean.match(/[a-z0-9$.%-]+/g) || ['document'];

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const isTicker = /^[a-z]{1,5}$/.test(token) && token.length <= 4;
        const isFinancialNumber = /^\$?\d+/.test(token);
        const weight = isTicker ? 3.0 : isFinancialNumber ? 2.5 : 1.0;

        let h1 = 2166136261;
        for (let c = 0; c < token.length; c++) {
          h1 = Math.imul(h1 ^ token.charCodeAt(c), 16777619);
        }
        const idx1 = Math.abs(h1) % this.dimensions;
        vector[idx1] += weight;

        if (token.length > 3) {
          for (let k = 0; k <= token.length - 3; k++) {
            const gram = token.slice(k, k + 3);
            let h2 = 0;
            for (let c = 0; c < 3; c++) {
              h2 = (h2 * 31 + gram.charCodeAt(c)) | 0;
            }
            const idx2 = Math.abs(h2) % this.dimensions;
            vector[idx2] += 0.4 * weight;
          }
        }
      }

      // L2 Normalization
      let norm = 0;
      for (let d = 0; d < this.dimensions; d++) {
        norm += vector[d] * vector[d];
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let d = 0; d < this.dimensions; d++) {
          vector[d] /= norm;
        }
      }
      return Array.from(vector);
    });
  }

  /**
   * OpenAI Embeddings API handler
   */
  async _embedOpenAI(texts) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          input: texts,
          model: this.model,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );

      return response.data.data.map(item => item.embedding);
    } catch (err) {
      this.logger.warn('OpenAI embedding failed, falling back to local transformer', {
        error: err.message,
      });
      return this._embedLocalTransformer(texts);
    }
  }

  /**
   * Voyage AI Embeddings API handler
   */
  async _embedVoyage(texts) {
    try {
      const response = await axios.post(
        'https://api.voyageai.com/v1/embeddings',
        {
          input: texts,
          model: this.model || 'voyage-finance-2',
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );

      return response.data.data.map(item => item.embedding);
    } catch (err) {
      this.logger.warn('Voyage AI embedding failed, falling back to local transformer', {
        error: err.message,
      });
      return this._embedLocalTransformer(texts);
    }
  }

  /**
   * Hugging Face Inference API handler (Optional)
   */
  async _embedHuggingFace(texts) {
    try {
      const response = await axios.post(
        `https://api-inference.huggingface.co/pipeline/feature-extraction/${this.model}`,
        { inputs: texts },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );

      return response.data;
    } catch (err) {
      this.logger.warn('Hugging Face embedding failed, falling back to local transformer', {
        error: err.message,
      });
      return this._embedLocalTransformer(texts);
    }
  }

  /**
   * Computes cosine similarity between two unit vectors.
   * When both vectors are L2 normalized (||v|| = 1), cosine similarity is their dot product.
   * @param {number[]} a 
   * @param {number[]} b 
   * @returns {number}
   */
  static cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return Math.max(0, Math.min(1, dot));
  }
}

export default EmbeddingClient;
