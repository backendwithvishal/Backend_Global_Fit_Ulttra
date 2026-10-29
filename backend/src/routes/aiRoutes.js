/**
 * Global_Fit_Ulttra - AI Routes
 * 
 * Express router for AI-powered financial analysis endpoints.
 * All endpoints use Groq AI (LLaMA models) for inference and are
 * validated with Zod schemas before processing.
 * 
 * Route Map:
 * ──────────────────────────────────────────────────────────────────────────
 * | Method | Path           | Handler               | Description          |
 * |--------|----------------|-----------------------|----------------------|
 * | GET    | /              | getInfo               | AI service info & map |
 * | POST   | /sentiment     | analyzeSentiment      | Text sentiment       |
 * | POST   | /analyze       | analyzeAsset          | Asset analysis       |
 * | POST   | /compare       | compareAssets         | Compare 2+ assets    |
 * | POST   | /recommend     | generateRecommendation| Investment advice    |
 * | POST   | /portfolio     | analyzePortfolio      | Portfolio health     |
 * | POST   | /predict       | predictPrice          | Price prediction     |
 * | POST   | /explain       | explainMovement       | Explain price move   |
 * | POST   | /news/impact   | analyzeNewsImpact     | News market impact   |
 * | POST   | /news/summary  | generateNewsSummary   | News summarization   |
 * | POST   | /jobs          | submitJob             | Async AI job         |
 * | GET    | /jobs/stats    | getQueueStats         | Job queue statistics |
 * ──────────────────────────────────────────────────────────────────────────
 * 
 * Rate Limiting: aiRateLimiter (10 req / 1 min per user/IP).
 * AI calls are expensive (Groq token consumption, latency), so the limit
 * is intentionally low with a short window.
 * 
 * Validation: All POST endpoints validate request body with Zod schemas
 * from validators/aiSchemas.js.
 * 
 * @module routes/aiRoutes
 */

import { Router } from 'express';
import { aiRateLimiter } from '../middleware/rateLimiter.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { checkAIQuota } from '../middleware/aiQuotaMiddleware.js';
import {
  validateRequest,
  sentimentSchema,
  analyzeSchema,
  compareSchema,
  recommendSchema,
  portfolioSchema,
  predictSchema,
  explainSchema,
  newsImpactSchema,
  newsSummarySchema,
  jobSchema,
} from '../validators/aiSchemas.js';
import { createRAGRoutes } from './ragRoutes.js';

/**
 * Create and configure the AI routes router.
 * 
 * @param {import('../controllers/AIController.js').AIController} aiController - Injected AI controller
 * @param {import('../controllers/RAGController.js').RAGController} [ragController] - Injected RAG controller
 * @returns {import('express').Router} Configured Express router
 */
export const createAIRoutes = (aiController, ragController = null) => {
  const router = Router();

  // Apply authentication and AI rate limiter to all AI routes
  router.use(requireAuth);
  router.use(aiRateLimiter);

  // Return 503 Service Unavailable if AI services are disabled
  if (!aiController && !ragController) {
    router.use((req, res) => {
      res.status(503).json({
        success: false,
        error: {
          code: 'E5003',
          message: 'AI services are currently disabled. Please configure GROQ_API_KEY to enable them.'
        },
        requestId: req.requestId
      });
    });
    return router;
  }

  // Mount RAG routes at /rag if ragController is available
  if (ragController) {
    router.use('/rag', createRAGRoutes(ragController));
  }

  // ─── AI Service Overview & Discovery ──────────────────────────────────
  router.get('/', (req, res) => {
    if (aiController && typeof aiController.getInfo === 'function') {
      return aiController.getInfo(req, res);
    }
    return res.json({
      success: true,
      service: 'Global_Fit_Ulttra AI Service',
      ragAvailable: !!ragController,
      status: 'active',
      requestId: req.requestId,
    });
  });

  // Guard: If aiController is not available, return 503 for non-RAG routes
  if (!aiController) {
    router.use((req, res) => {
      res.status(503).json({
        success: false,
        error: {
          code: 'E5003',
          message: 'Groq AI services are currently disabled. Please configure GROQ_API_KEY to enable them.'
        },
        requestId: req.requestId
      });
    });
    return router;
  }

  // ─── Sentiment Analysis ────────────────────────────────────────────────
  // Analyzes text for bullish/bearish/neutral sentiment with confidence score
  router.post('/sentiment', checkAIQuota, validateRequest(sentimentSchema), aiController.analyzeSentiment);

  // ─── Asset Analysis ────────────────────────────────────────────────────
  // Deep analysis of a single asset (trend, support/resistance, recommendation)
  router.post('/analyze', checkAIQuota, validateRequest(analyzeSchema), aiController.analyzeAsset);

  // Compare two or more assets side-by-side
  router.post('/compare', checkAIQuota, validateRequest(compareSchema), aiController.compareAssets);

  // ─── Recommendations ───────────────────────────────────────────────────
  // Personalized investment recommendations based on user profile and market data
  router.post('/recommend', checkAIQuota, validateRequest(recommendSchema), aiController.generateRecommendation);

  // Portfolio health analysis with diversification and risk assessment
  router.post('/portfolio', checkAIQuota, validateRequest(portfolioSchema), aiController.analyzePortfolio);

  // ─── Predictions ───────────────────────────────────────────────────────
  // AI-powered price prediction (disclaimer: not financial advice)
  router.post('/predict', checkAIQuota, validateRequest(predictSchema), aiController.predictPrice);

  // Natural language explanation of recent price movements
  router.post('/explain', checkAIQuota, validateRequest(explainSchema), aiController.explainMovement);

  // ─── News Analysis ─────────────────────────────────────────────────────
  // Analyze potential market impact of news articles
  router.post('/news/impact', checkAIQuota, validateRequest(newsImpactSchema), aiController.analyzeNewsImpact);

  // Generate concise summary of multiple news articles
  router.post('/news/summary', checkAIQuota, validateRequest(newsSummarySchema), aiController.generateNewsSummary);

  // ─── Job Queue (Async Processing) ─────────────────────────────────────
  // Submit a long-running AI job to the RabbitMQ queue
  router.post('/jobs', checkAIQuota, validateRequest(jobSchema), aiController.submitJob);

  // Get current job queue statistics (pending, processing, completed)
  router.get('/jobs/stats', aiController.getQueueStats);

  return router;
};

export default createAIRoutes;
