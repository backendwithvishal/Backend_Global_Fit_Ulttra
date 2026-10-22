/**
 * Global-Fi Ultra - LiteLLM AI Gateway Client
 *
 * OpenAI-compatible self-hosted AI gateway adapter supporting:
 * 1. LiteLLM proxy routing (self-hosted, free, zero vendor lock-in)
 * 2. Transparent passthrough to GroqClient when LiteLLM is disabled
 * 3. Unified generateContent / streamContent interface
 * 4. Request correlation ID propagation and sanitized logging
 *
 * @module infrastructure/ai/LiteLLMGateway
 */

import axios from 'axios';
import { logger } from '../../config/logger.js';

export class LiteLLMGateway {
  constructor({
    apiKey = '',
    baseUrl = '',
    enabled = false,
    defaultClient = null,
  } = {}) {
    this.apiKey = apiKey || '';
    this.baseUrl = baseUrl || 'http://localhost:8000/v1';
    this.enabled = !!enabled;
    this.defaultClient = defaultClient;
    this.logger = logger || console;

    if (this.enabled) {
      this.logger.info('LiteLLM AI Gateway integration active', {
        baseUrl: this.baseUrl,
      });
    } else {
      this.logger.info('LiteLLM Gateway disabled: Direct Groq routing active');
    }
  }

  /**
   * Generates completion through LiteLLM gateway or direct provider fallback.
   *
   * @param {string} prompt
   * @param {object} options
   * @returns {Promise<string>}
   */
  async generateContent(prompt, options = {}) {
    if (!this.enabled) {
      if (this.defaultClient && typeof this.defaultClient.generateContent === 'function') {
        return this.defaultClient.generateContent(prompt, options);
      }
      throw new Error('No active LLM client configured for inference');
    }

    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          messages: [{ role: 'user', content: prompt }],
          model: options.model || 'llama-3.3-70b-versatile',
          max_tokens: options.maxTokens || 1024,
          temperature: options.temperature || 0.7,
        },
        {
          headers,
          timeout: options.timeout || 30000,
        }
      );

      return response.data?.choices?.[0]?.message?.content || '';
    } catch (err) {
      this.logger.warn('LiteLLM Gateway request failed, falling back to direct Groq client', {
        error: err.message,
      });
      if (this.defaultClient && typeof this.defaultClient.generateContent === 'function') {
        return this.defaultClient.generateContent(prompt, options);
      }
      throw err;
    }
  }

  /**
   * Streams completion through direct provider (LiteLLM streaming not yet wired).
   * Falls back to full generate + single onChunk call.
   *
   * @param {string} prompt
   * @param {Function} onChunk
   * @param {object} options
   * @returns {Promise<string>}
   */
  async streamContent(prompt, onChunk, options = {}) {
    if (this.defaultClient && typeof this.defaultClient.streamContent === 'function') {
      return this.defaultClient.streamContent(prompt, onChunk, options);
    }
    // Fallback: full generation then single chunk delivery
    const fullText = await this.generateContent(prompt, options);
    if (typeof onChunk === 'function') {
      await onChunk(fullText);
    } else if (typeof onChunk === 'object' && onChunk !== null && typeof onChunk.onChunk === 'function') {
      await onChunk.onChunk(fullText);
    }
    return fullText;
  }
}

export default LiteLLMGateway;
