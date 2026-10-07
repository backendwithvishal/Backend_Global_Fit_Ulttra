// Groq AI client - handles model selection, retries, caching, and streaming

import Groq from 'groq-sdk';
import crypto from 'crypto';
import { AI_CONFIG } from './aiConfig.js';

// Custom error classes for AI operations
export class AIServiceError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'AIServiceError';
    this.originalError = originalError;
  }
}

export class AIRateLimitError extends AIServiceError {
  constructor(retryAfter = 60) {
    super(`Rate limit exceeded. Retry after ${retryAfter} seconds`);
    this.name = 'AIRateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class AIAuthError extends AIServiceError {
  constructor() {
    super('Invalid Groq API key. Please check GROQ_API_KEY environment variable');
    this.name = 'AIAuthError';
  }
}

export class AITimeoutError extends AIServiceError {
  constructor(timeout) {
    super(`Request timeout after ${timeout}ms`);
    this.name = 'AITimeoutError';
    this.timeout = timeout;
  }
}

export class GroqClient {
  constructor({ apiKey, cacheService, logger }) {
    if (!apiKey) {
      throw new Error('Groq API key is required');
    }

    this.apiKey = apiKey;
    this.cacheService = cacheService;
    this.logger = logger || console;

    this.client = new Groq({
      apiKey: this.apiKey
    });

    this.config = AI_CONFIG;

    this.totalTokensUsed = 0;
    this.totalRequests = 0;
    this.cacheHits = 0;

    this.logger.info('GroqClient initialized', {
      models: this.config.models
    });
  }

  // Pick the right model based on task complexity
  _selectModel(complex = false) {
    return complex 
      ? this.config.models.primary   // Llama 3.3 70B for complex tasks
      : this.config.models.fast;     // Llama 3.1 8B for simple tasks
  }

  // Generate cache key from prompt
  _generateCacheKey(prompt, options = {}) {
    const hash = crypto
      .createHash('md5')
      .update(prompt + JSON.stringify(options))
      .digest('hex');
    return `ai:response:${hash}`;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Execute request with retry logic
  async _withRetry(requestFn, attempt = 1) {
    try {
      return await requestFn();
    } catch (error) {
      const shouldRetry = 
        attempt < this.config.retries.maxAttempts &&
        (error.status === 429 || error.status >= 500);

      if (!shouldRetry) {
        throw error;
      }

      const backoff = Math.min(
        this.config.retries.initialBackoffMs * 
        Math.pow(this.config.retries.backoffMultiplier, attempt - 1),
        this.config.retries.maxBackoffMs
      );

      this.logger.warn('Retrying request', {
        attempt,
        backoffMs: backoff,
        error: error.message
      });

      await this._sleep(backoff);
      return this._withRetry(requestFn, attempt + 1);
    }
  }

  async validateApiKey() {
    try {
      await this.client.chat.completions.create({
        model: this.config.models.fast,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1
      });
      return true;
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        throw new AIAuthError();
      }
      throw new AIServiceError(`API key validation failed: ${error.message || error}`, error);
    }
  }

  async generateContent(prompt, options = {}) {
    const {
      complex = false,
      maxTokens = this.config.generation.maxTokens,
      temperature = this.config.generation.temperature,
      cache = this.config.cache.enabled
    } = options;

    // Check cache first
    if (cache && this.cacheService) {
      const cacheKey = this._generateCacheKey(prompt, options);
      const cached = await this.cacheService.get(cacheKey);
      
      if (cached) {
        this.logger.info('AI cache hit', { cacheKey });
        this.cacheHits++;
        this.totalRequests++;
        return cached;
      }
    }

    const model = this._selectModel(complex);

    this.logger.info('Generating AI content', {
      model,
      promptLength: prompt.length,
      maxTokens
    });

    try {
      const response = await this._withRetry(async () => {
        return await this.client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature,
          top_p: this.config.generation.topP
        });
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new AIServiceError('Empty response from Groq API');
      }

      this.totalRequests++;
      if (response.usage?.total_tokens) {
        this.totalTokensUsed += response.usage.total_tokens;
      }

      // Cache successful response
      if (cache && this.cacheService) {
        const cacheKey = this._generateCacheKey(prompt, options);
        const ttl = this.config.cache.ttl.standard;
        await this.cacheService.set(cacheKey, content, ttl);
      }

      this.logger.info('AI generation successful', {
        model,
        outputLength: content.length,
        tokensUsed: response.usage?.total_tokens
      });

      return content;
    } catch (error) {
      this.logger.error('AI generation failed', {
        error: error.message,
        model,
        prompt: prompt.substring(0, 100)
      });

      if (error.status === 429) {
        throw new AIRateLimitError();
      }
      if (error.status === 401 || error.status === 403) {
        throw new AIAuthError();
      }

      throw new AIServiceError('Content generation failed', error);
    }
  }

  async streamContent(prompt, onChunk, options = {}) {
    const {
      complex = true,
      maxTokens = this.config.generation.maxTokens,
      temperature = this.config.generation.temperature
    } = options;

    const model = this._selectModel(complex);

    this.logger.info('Starting AI stream', {
      model,
      promptLength: prompt.length
    });

    try {
      this.totalRequests++;
      const stream = await this.client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
        stream: true
      });

      let fullResponse = '';

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullResponse += content;
          await onChunk(content);
        }
      }

      this.logger.info('AI stream complete', {
        model,
        outputLength: fullResponse.length
      });

      return fullResponse;
    } catch (error) {
      this.logger.error('AI streaming failed', {
        error: error.message,
        model
      });

      throw new AIServiceError('Content streaming failed', error);
    }
  }

  async generateJSON(prompt, schema = null, options = {}) {
    const jsonPrompt = `${prompt}

CRITICAL: Respond with ONLY valid JSON. No markdown, no code blocks, no explanations.
Output format must match the specified schema exactly.`;

    const response = await this.generateContent(jsonPrompt, options);

    try {
      const cleaned = response
        .replace(/```json\n?|\n?```/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      if (schema && typeof schema === 'object') {
        const requiredKeys = Object.keys(schema);
        const missingKeys = requiredKeys.filter(key => !(key in parsed));

        if (missingKeys.length > 0) {
          this.logger.warn('JSON response missing keys', {
            missingKeys,
            receivedKeys: Object.keys(parsed)
          });
        }
      }

      return parsed;
    } catch (error) {
      this.logger.error('JSON parsing failed', {
        error: error.message,
        response: response.substring(0, 200)
      });

      throw new AIServiceError('Invalid JSON response from AI', error);
    }
  }

  getUsageStats() {
    const hitRate = this.totalRequests > 0 ? (this.cacheHits / this.totalRequests) : 0;
    return {
      tokensUsed: this.totalTokensUsed,
      requestsToday: this.totalRequests,
      cacheHitRate: Math.round(hitRate * 100) / 100
    };
  }
}

export default GroqClient;