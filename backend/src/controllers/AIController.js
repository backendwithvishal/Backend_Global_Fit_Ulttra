// AI-powered features - sentiment analysis, market insights, recommendations
// All responses include disclaimers since this is NOT financial advice

import { logger } from '../config/logger.js';
import { config } from '../config/environment.js';
import { sanitizeAIInput } from '../utils/sanitizer.js';

export class AIController {
  constructor({ aiNewsService, aiMarketService, aiJobQueue }) {
    if (!aiNewsService || !aiMarketService) {
      throw new Error('AI services are required');
    }

    this.aiNewsService = aiNewsService;
    this.aiMarketService = aiMarketService;
    this.aiJobQueue = aiJobQueue;
    this.logger = logger || console;
  }

  _sendError(res, req, error, actionName) {
    const msg = error?.message || '';
    const isUnavailable =
      msg.includes('API key') ||
      msg.includes('unavailable') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('No active LLM') ||
      msg.includes('unreachable') ||
      error?.status === 503 ||
      error?.code === 'E5003';

    const statusCode = isUnavailable ? 503 : 500;
    const errorCode = isUnavailable ? 'E5003' : 'E5000';

    return res.status(statusCode).json({
      success: false,
      error: {
        code: errorCode,
        message: `${actionName} unavailable: ${msg || 'AI inference service failed'}`,
      },
      requestId: req.requestId,
    });
  }

  // Service overview and endpoint discovery
  getInfo = async (req, res) => {
    return res.status(200).json({
      success: true,
      service: 'Global_Fit_Ulttra AI Service',
      version: '1.0.0',
      status: 'active',
      models: {
        primary: config.ai.primaryModel,
        fast: config.ai.fastModel,
      },
      endpoints: {
        sentiment: 'POST /api/v1/ai/sentiment',
        analyze: 'POST /api/v1/ai/analyze',
        compare: 'POST /api/v1/ai/compare',
        recommend: 'POST /api/v1/ai/recommend',
        portfolio: 'POST /api/v1/ai/portfolio',
        predict: 'POST /api/v1/ai/predict',
        explain: 'POST /api/v1/ai/explain',
        newsImpact: 'POST /api/v1/ai/news/impact',
        newsSummary: 'POST /api/v1/ai/news/summary',
        submitJob: 'POST /api/v1/ai/jobs',
        jobStats: 'GET /api/v1/ai/jobs/stats',
      },
      requestId: req.requestId,
    });
  };

  // Analyze sentiment of text - works for news articles or general text
  analyzeSentiment = async (req, res) => {
    try {
      const { text, type = 'general' } = req.body || {};

      if (!text || typeof text !== 'string') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'E4000',
            message: 'Text is required for sentiment analysis',
          },
          requestId: req.requestId,
        });
      }

      const sanitizedText = sanitizeAIInput(text);

      this.logger.info('Sentiment analysis request', {
        requestId: req.requestId,
        type,
        textLength: text.length,
      });

      const result = await this.aiNewsService.analyzeSentiment(sanitizedText);

      return res.status(200).json({
        success: true,
        data: result,
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Sentiment analysis failed', {
        requestId: req.requestId,
        error: error.message,
      });
      return this._sendError(res, req, error, 'Sentiment analysis');
    }
  };

  // AI analysis of a single asset based on price data
  analyzeAsset = async (req, res) => {
    try {
      const { symbol, priceData } = req.body || {};

      if (!symbol || !priceData) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'E4000',
            message: 'Symbol and price data are required',
          },
          requestId: req.requestId,
        });
      }

      this.logger.info('Asset analysis request', {
        requestId: req.requestId,
        symbol,
      });

      const result = await this.aiMarketService.analyzeAsset(symbol, priceData);

      return res.status(200).json({
        success: true,
        data: result,
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Asset analysis failed', {
        requestId: req.requestId,
        error: error.message,
      });
      return this._sendError(res, req, error, 'Asset analysis');
    }
  };

  // Compare multiple assets side-by-side (need at least 2)
  compareAssets = async (req, res) => {
    try {
      const { assets } = req.body || {};

      if (!assets || !Array.isArray(assets) || assets.length < 2) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'E4000',
            message: 'At least 2 assets are required for comparison',
          },
          requestId: req.requestId,
        });
      }

      this.logger.info('Asset comparison request', {
        requestId: req.requestId,
        assetsCount: assets.length,
      });

      const result = await this.aiMarketService.compareAssets(assets);

      return res.status(200).json({
        success: true,
        data: result,
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Asset comparison failed', {
        requestId: req.requestId,
        error: error.message,
      });
      return this._sendError(res, req, error, 'Asset comparison');
    }
  };

  // Generate investment recommendations based on user profile and market data
  generateRecommendation = async (req, res) => {
    try {
      const { userProfile, marketData } = req.body || {};

      if (!userProfile || !marketData) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'E4000',
            message: 'User profile and market data are required',
          },
          requestId: req.requestId,
        });
      }

      this.logger.info('Recommendation request', {
        requestId: req.requestId,
        riskTolerance: userProfile.riskTolerance,
      });

      const result = await this.aiMarketService.generateRecommendation(
        userProfile,
        marketData
      );

      return res.status(200).json({
        success: true,
        data: result,
        disclaimer: 'This is not financial advice. Always do your own research.',
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Recommendation generation failed', {
        requestId: req.requestId,
        error: error.message,
      });
      return this._sendError(res, req, error, 'Recommendation generation');
    }
  };

  // Analyze entire portfolio - diversification, risk, suggestions
  analyzePortfolio = async (req, res) => {
    try {
      const { holdings, marketConditions } = req.body || {};

      if (!holdings || !Array.isArray(holdings)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'E4000',
            message: 'Holdings array is required',
          },
          requestId: req.requestId,
        });
      }

      this.logger.info('Portfolio analysis request', {
        requestId: req.requestId,
        holdingsCount: holdings.length,
      });

      const result = await this.aiMarketService.analyzePortfolio(
        holdings,
        marketConditions || {}
      );

      return res.status(200).json({
        success: true,
        data: result,
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Portfolio analysis failed', {
        requestId: req.requestId,
        error: error.message,
      });
      return this._sendError(res, req, error, 'Portfolio analysis');
    }
  };

  // Predict future price movement (default 7 days ahead)
  predictPrice = async (req, res) => {
    try {
      const { symbol, historicalData, daysAhead = 7 } = req.body || {};

      if (!symbol || !historicalData) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'E4000',
            message: 'Symbol and historical data are required',
          },
          requestId: req.requestId,
        });
      }

      this.logger.info('Price prediction request', {
        requestId: req.requestId,
        symbol,
        daysAhead,
      });

      const result = await this.aiMarketService.predictPrice(
        symbol,
        historicalData,
        daysAhead
      );

      return res.status(200).json({
        success: true,
        data: result,
        disclaimer: 'Predictions are for educational purposes only. Not financial advice.',
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Price prediction failed', {
        requestId: req.requestId,
        error: error.message,
      });
      return this._sendError(res, req, error, 'Price prediction');
    }
  };

  // Explain why a stock/crypto moved up or down
  explainMovement = async (req, res) => {
    try {
      const { symbol, changePercent, recentNews = [] } = req.body || {};

      if (!symbol || changePercent === undefined) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'E4000',
            message: 'Symbol and change percent are required',
          },
          requestId: req.requestId,
        });
      }

      this.logger.info('Movement explanation request', {
        requestId: req.requestId,
        symbol,
        changePercent,
      });

      const explanation = await this.aiMarketService.explainMovement(
        symbol,
        changePercent,
        recentNews
      );

      return res.status(200).json({
        success: true,
        data: { explanation },
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Movement explanation failed', {
        requestId: req.requestId,
        error: error.message,
      });
      return this._sendError(res, req, error, 'Movement explanation');
    }
  };

  // Analyze how news articles might impact the market
  analyzeNewsImpact = async (req, res) => {
    try {
      const { newsArticles } = req.body || {};

      if (!newsArticles || !Array.isArray(newsArticles)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'E4000',
            message: 'News articles array is required',
          },
          requestId: req.requestId,
        });
      }

      this.logger.info('News impact analysis request', {
        requestId: req.requestId,
        articlesCount: newsArticles.length,
      });

      const result = await this.aiNewsService.analyzeMarketImpact(newsArticles);

      return res.status(200).json({
        success: true,
        data: result,
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('News impact analysis failed', {
        requestId: req.requestId,
        error: error.message,
      });
      return this._sendError(res, req, error, 'News impact analysis');
    }
  };

  // Summarize multiple news articles into a short digest
  generateNewsSummary = async (req, res) => {
    try {
      const { newsArticles, maxLength = 100 } = req.body || {};

      if (!newsArticles || !Array.isArray(newsArticles)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'E4000',
            message: 'News articles array is required',
          },
          requestId: req.requestId,
        });
      }

      this.logger.info('News summary request', {
        requestId: req.requestId,
        articlesCount: newsArticles.length,
      });

      const summary = await this.aiNewsService.generateSummary(
        newsArticles,
        maxLength
      );

      return res.status(200).json({
        success: true,
        data: { summary },
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('News summary generation failed', {
        requestId: req.requestId,
        error: error.message,
      });
      return this._sendError(res, req, error, 'News summary generation');
    }
  };

  // Submit async AI job to queue (for long-running tasks)
  submitJob = async (req, res) => {
    try {
      if (!this.aiJobQueue) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'E5003',
            message: 'Job queue not available (RabbitMQ disconnected)',
          },
          requestId: req.requestId,
        });
      }

      const { jobType, data, priority = 0 } = req.body || {};

      if (!jobType || !data) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'E4000',
            message: 'Job type and data are required',
          },
          requestId: req.requestId,
        });
      }

      this.logger.info('Job submission request', {
        requestId: req.requestId,
        jobType,
      });

      const success = await this.aiJobQueue.publishJob(jobType, data, { priority });

      if (success) {
        return res.status(200).json({
          success: true,
          message: 'Job submitted successfully',
          requestId: req.requestId,
        });
      } else {
        return res.status(500).json({
          success: false,
          error: {
            code: 'E5000',
            message: 'Failed to submit job to queue',
          },
          requestId: req.requestId,
        });
      }
    } catch (error) {
      this.logger.error('Job submission failed', {
        requestId: req.requestId,
        error: error.message,
      });
      return this._sendError(res, req, error, 'Job submission');
    }
  };

  // Get job queue stats - pending, processing, completed
  getQueueStats = async (req, res) => {
    try {
      if (!this.aiJobQueue) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'E5003',
            message: 'Job queue not available (RabbitMQ disconnected)',
          },
          requestId: req.requestId,
        });
      }

      const stats = await this.aiJobQueue.getQueueStats();

      return res.status(200).json({
        success: true,
        data: stats,
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Failed to get queue stats', {
        requestId: req.requestId,
        error: error.message,
      });
      return this._sendError(res, req, error, 'Queue stats');
    }
  };
}

export default AIController;
