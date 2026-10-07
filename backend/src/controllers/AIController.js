// AI-powered features - sentiment analysis, market insights, recommendations
// All responses include disclaimers since this is NOT financial advice

import { logger } from '../config/logger.js';
import { sanitizeAIInput } from '../utils/sanitizer.js';

export class AIController {
  constructor({ aiNewsService, aiMarketService, aiJobQueue }) {
    if (!aiNewsService || !aiMarketService) {
      throw new Error('AI services are required');
    }

    this.aiNewsService = aiNewsService;
    this.aiMarketService = aiMarketService;
    this.aiJobQueue = aiJobQueue;
    this.logger = logger;
  }

  // Service overview and endpoint discovery
  getInfo = async (req, res) => {
    res.json({
      success: true,
      service: 'Global-Fi Ultra AI Service',
      version: '1.0.0',
      status: 'active',
      models: {
        primary: process.env.GROQ_PRIMARY_MODEL || 'llama-3.3-70b-versatile',
        fast: process.env.GROQ_FAST_MODEL || 'llama-3.1-8b-instant',
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
      const { text, type = 'general' } = req.body;

      // Sanitize user input before passing to AI
      const sanitizedText = sanitizeAIInput(text);

      if (!text) {
        return res.status(400).json({
          success: false,
          error: 'Text is required'
        });
      }

      this.logger.info('Sentiment analysis request', {
        requestId: req.requestId,
        type,
        textLength: text.length
      });

      const result = await this.aiNewsService.analyzeSentiment(sanitizedText);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      this.logger.error('Sentiment analysis failed', {
        requestId: req.requestId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Sentiment analysis failed'
      });
    }
  };

  // AI analysis of a single asset based on price data
  analyzeAsset = async (req, res) => {
    try {
      const { symbol, priceData } = req.body;

      if (!symbol || !priceData) {
        return res.status(400).json({
          success: false,
          error: 'Symbol and price data are required'
        });
      }

      this.logger.info('Asset analysis request', {
        requestId: req.requestId,
        symbol
      });

      const result = await this.aiMarketService.analyzeAsset(symbol, priceData);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      this.logger.error('Asset analysis failed', {
        requestId: req.requestId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Asset analysis failed'
      });
    }
  };

  // Compare multiple assets side-by-side (need at least 2)
  compareAssets = async (req, res) => {
    try {
      const { assets } = req.body;

      if (!assets || !Array.isArray(assets) || assets.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'At least 2 assets are required'
        });
      }

      this.logger.info('Asset comparison request', {
        requestId: req.requestId,
        assetsCount: assets.length
      });

      const result = await this.aiMarketService.compareAssets(assets);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      this.logger.error('Asset comparison failed', {
        requestId: req.requestId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Asset comparison failed'
      });
    }
  };

  // Generate investment recommendations based on user profile and market data
  generateRecommendation = async (req, res) => {
    try {
      const { userProfile, marketData } = req.body;

      if (!userProfile || !marketData) {
        return res.status(400).json({
          success: false,
          error: 'User profile and market data are required'
        });
      }

      this.logger.info('Recommendation request', {
        requestId: req.requestId,
        riskTolerance: userProfile.riskTolerance
      });

      const result = await this.aiMarketService.generateRecommendation(
        userProfile,
        marketData
      );

      res.json({
        success: true,
        data: result,
        disclaimer: 'This is not financial advice. Always do your own research.'
      });
    } catch (error) {
      this.logger.error('Recommendation generation failed', {
        requestId: req.requestId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Recommendation generation failed'
      });
    }
  };

  // Analyze entire portfolio - diversification, risk, suggestions
  analyzePortfolio = async (req, res) => {
    try {
      const { holdings, marketConditions } = req.body;

      if (!holdings || !Array.isArray(holdings)) {
        return res.status(400).json({
          success: false,
          error: 'Holdings array is required'
        });
      }

      this.logger.info('Portfolio analysis request', {
        requestId: req.requestId,
        holdingsCount: holdings.length
      });

      const result = await this.aiMarketService.analyzePortfolio(
        holdings,
        marketConditions || {}
      );

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      this.logger.error('Portfolio analysis failed', {
        requestId: req.requestId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Portfolio analysis failed'
      });
    }
  };

  // Predict future price movement (default 7 days ahead)
  predictPrice = async (req, res) => {
    try {
      const { symbol, historicalData, daysAhead = 7 } = req.body;

      if (!symbol || !historicalData) {
        return res.status(400).json({
          success: false,
          error: 'Symbol and historical data are required'
        });
      }

      this.logger.info('Price prediction request', {
        requestId: req.requestId,
        symbol,
        daysAhead
      });

      const result = await this.aiMarketService.predictPrice(
        symbol,
        historicalData,
        daysAhead
      );

      res.json({
        success: true,
        data: result,
        disclaimer: 'Predictions are for educational purposes only. Not financial advice.'
      });
    } catch (error) {
      this.logger.error('Price prediction failed', {
        requestId: req.requestId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Price prediction failed'
      });
    }
  };

  // Explain why a stock/crypto moved up or down
  explainMovement = async (req, res) => {
    try {
      const { symbol, changePercent, recentNews = [] } = req.body;

      if (!symbol || changePercent === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Symbol and change percent are required'
        });
      }

      this.logger.info('Movement explanation request', {
        requestId: req.requestId,
        symbol,
        changePercent
      });

      const explanation = await this.aiMarketService.explainMovement(
        symbol,
        changePercent,
        recentNews
      );

      res.json({
        success: true,
        data: { explanation }
      });
    } catch (error) {
      this.logger.error('Movement explanation failed', {
        requestId: req.requestId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Movement explanation failed'
      });
    }
  };

  // Analyze how news articles might impact the market
  analyzeNewsImpact = async (req, res) => {
    try {
      const { newsArticles } = req.body;

      if (!newsArticles || !Array.isArray(newsArticles)) {
        return res.status(400).json({
          success: false,
          error: 'News articles array is required'
        });
      }

      this.logger.info('News impact analysis request', {
        requestId: req.requestId,
        articlesCount: newsArticles.length
      });

      const result = await this.aiNewsService.analyzeMarketImpact(newsArticles);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      this.logger.error('News impact analysis failed', {
        requestId: req.requestId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'News impact analysis failed'
      });
    }
  };

  // Summarize multiple news articles into a short digest
  generateNewsSummary = async (req, res) => {
    try {
      const { newsArticles, maxLength = 100 } = req.body;

      if (!newsArticles || !Array.isArray(newsArticles)) {
        return res.status(400).json({
          success: false,
          error: 'News articles array is required'
        });
      }

      this.logger.info('News summary request', {
        requestId: req.requestId,
        articlesCount: newsArticles.length
      });

      const summary = await this.aiNewsService.generateSummary(
        newsArticles,
        maxLength
      );

      res.json({
        success: true,
        data: { summary }
      });
    } catch (error) {
      this.logger.error('News summary generation failed', {
        requestId: req.requestId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'News summary generation failed'
      });
    }
  };

  // Submit async AI job to queue (for long-running tasks)
  submitJob = async (req, res) => {
    try {
      if (!this.aiJobQueue) {
        return res.status(503).json({
          success: false,
          error: 'Job queue not available'
        });
      }

      const { jobType, data, priority = 0 } = req.body;

      if (!jobType || !data) {
        return res.status(400).json({
          success: false,
          error: 'Job type and data are required'
        });
      }

      this.logger.info('Job submission request', {
        requestId: req.requestId,
        jobType
      });

      const success = await this.aiJobQueue.publishJob(jobType, data, { priority });

      if (success) {
        res.json({
          success: true,
          message: 'Job submitted successfully'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to submit job'
        });
      }
    } catch (error) {
      this.logger.error('Job submission failed', {
        requestId: req.requestId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  };

  // Get job queue stats - pending, processing, completed
  getQueueStats = async (req, res) => {
    try {
      if (!this.aiJobQueue) {
        return res.status(503).json({
          success: false,
          error: 'Job queue not available'
        });
      }

      const stats = await this.aiJobQueue.getQueueStats();

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      this.logger.error('Failed to get queue stats', {
        requestId: req.requestId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get queue stats'
      });
    }
  };
}

export default AIController;
