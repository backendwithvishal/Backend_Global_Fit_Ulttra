// AI market analysis - price predictions, trends, investment recommendations
// Uses Groq AI for analysis with caching

import { logger } from '../config/logger.js';

export class AIMarketService {
  constructor({ groqClient, cacheService }) {
    if (!groqClient) {
      throw new Error('GroqClient is required');
    }

    this.groqClient = groqClient;
    this.cacheService = cacheService;
    this.logger = logger;
  }

  // Analyze asset - trend, support/resistance, outlook, risk
  async analyzeAsset(symbol, priceData) {
    const prompt = `Analyze this financial asset:

Symbol: ${symbol}
Current Price: ${priceData.current}
24h Change: ${priceData.change24h}%
Volume: ${priceData.volume}
Market Cap: ${priceData.marketCap || 'N/A'}

Recent price history:
${JSON.stringify(priceData.history?.slice(-10) || [], null, 2)}

Provide:
1. Overall trend (bullish/bearish/neutral)
2. Confidence score (0-100)
3. Key support and resistance levels
4. Short-term outlook (1-7 days)
5. Risk assessment (low/medium/high)
6. Brief reasoning (2-3 sentences)

Return JSON format:
{
  "trend": "bullish|bearish|neutral",
  "confidence": 75,
  "support": 150.00,
  "resistance": 160.00,
  "outlook": "positive|negative|neutral",
  "risk": "low|medium|high",
  "reasoning": "explanation here"
}`;

    try {
      const result = await this.groqClient.generateJSON(
        prompt,
        {
          trend: '',
          confidence: 0,
          support: 0,
          resistance: 0,
          outlook: '',
          risk: '',
          reasoning: ''
        },
        { complex: true, cache: true }
      );

      this.logger.info('Asset analysis complete', {
        symbol,
        trend: result.trend,
        confidence: result.confidence
      });

      return result;
    } catch (error) {
      this.logger.error('Asset analysis failed', {
        error: error.message,
        symbol
      });
      throw error;
    }
  }

  // Compare multiple assets and recommend best investment
  async compareAssets(assets) {
    if (!assets || assets.length < 2) {
      return {
        recommendation: 'neutral',
        reasoning: 'Need at least 2 assets to compare',
        rankings: []
      };
    }

    const assetsData = assets.map(asset => ({
      symbol: asset.symbol,
      price: asset.price,
      change24h: asset.change24h,
      volume: asset.volume
    }));

    const prompt = `Compare these financial assets and recommend the best investment:

${JSON.stringify(assetsData, null, 2)}

Provide:
1. Recommended asset to invest in
2. Reasoning (2-3 sentences)
3. Rankings from best to worst
4. Risk comparison

Return JSON format:
{
  "recommendation": "AAPL",
  "reasoning": "explanation here",
  "rankings": ["AAPL", "MSFT", "GOOGL"],
  "riskComparison": "AAPL has lower volatility..."
}`;

    try {
      const result = await this.groqClient.generateJSON(
        prompt,
        {
          recommendation: '',
          reasoning: '',
          rankings: [],
          riskComparison: ''
        },
        { complex: true, cache: true }
      );

      this.logger.info('Asset comparison complete', {
        assetsCount: assets.length,
        recommendation: result.recommendation
      });

      return result;
    } catch (error) {
      this.logger.error('Asset comparison failed', {
        error: error.message,
        assetsCount: assets.length
      });
      throw error;
    }
  }

  // Generate personalized investment recommendations based on user profile
  async generateRecommendation(userProfile, marketData) {
    const prompt = `Generate investment recommendation based on:

User Profile:
- Risk Tolerance: ${userProfile.riskTolerance}
- Investment Horizon: ${userProfile.horizon}
- Portfolio Size: ${userProfile.portfolioSize}
- Sectors of Interest: ${userProfile.sectors?.join(', ') || 'Any'}

Current Market Data:
${JSON.stringify(marketData.slice(0, 10), null, 2)}

Provide:
1. Top 3 recommended assets
2. Allocation percentages
3. Reasoning for each pick
4. Overall strategy
5. Risk warnings

Return JSON format:
{
  "recommendations": [
    {
      "symbol": "AAPL",
      "allocation": 40,
      "reasoning": "Strong fundamentals..."
    }
  ],
  "strategy": "Diversified growth strategy...",
  "riskWarnings": ["Market volatility high"]
}`;

    try {
      const result = await this.groqClient.generateJSON(
        prompt,
        {
          recommendations: [],
          strategy: '',
          riskWarnings: []
        },
        { complex: true, cache: true }
      );

      this.logger.info('Investment recommendation generated', {
        recommendationsCount: result.recommendations?.length || 0,
        riskTolerance: userProfile.riskTolerance
      });

      return result;
    } catch (error) {
      this.logger.error('Recommendation generation failed', {
        error: error.message
      });
      throw error;
    }
  }

  // Analyze portfolio - health, diversification, risk, suggested adjustments
  async analyzePortfolio(holdings, marketConditions) {
    const prompt = `Analyze this investment portfolio:

Holdings:
${JSON.stringify(holdings, null, 2)}

Market Conditions:
${JSON.stringify(marketConditions, null, 2)}

Provide:
1. Overall portfolio health (excellent/good/fair/poor)
2. Diversification score (0-100)
3. Risk level (low/medium/high)
4. Suggested adjustments
5. Strengths and weaknesses

Return JSON format:
{
  "health": "good",
  "diversificationScore": 75,
  "riskLevel": "medium",
  "adjustments": ["Reduce tech exposure", "Add bonds"],
  "strengths": ["Good sector diversity"],
  "weaknesses": ["High concentration in tech"]
}`;

    try {
      const result = await this.groqClient.generateJSON(
        prompt,
        {
          health: '',
          diversificationScore: 0,
          riskLevel: '',
          adjustments: [],
          strengths: [],
          weaknesses: []
        },
        { complex: true, cache: true }
      );

      this.logger.info('Portfolio analysis complete', {
        holdingsCount: holdings.length,
        health: result.health
      });

      return result;
    } catch (error) {
      this.logger.error('Portfolio analysis failed', {
        error: error.message
      });
      throw error;
    }
  }

  // Predict price movement for next X days (educational only, not financial advice)
  async predictPrice(symbol, historicalData, daysAhead = 7) {
    const prompt = `Predict price movement for ${symbol}:

Historical Data (last 30 days):
${JSON.stringify(historicalData.slice(-30), null, 2)}

Predict price movement for next ${daysAhead} days.

IMPORTANT: This is for educational purposes only. Not financial advice.

Provide:
1. Predicted direction (up/down/sideways)
2. Confidence level (0-100)
3. Estimated price range
4. Key factors influencing prediction
5. Disclaimer

Return JSON format:
{
  "direction": "up|down|sideways",
  "confidence": 60,
  "priceRange": {
    "low": 145.00,
    "high": 155.00
  },
  "factors": ["Strong earnings", "Market momentum"],
  "disclaimer": "This is not financial advice..."
}`;

    try {
      const result = await this.groqClient.generateJSON(
        prompt,
        {
          direction: '',
          confidence: 0,
          priceRange: { low: 0, high: 0 },
          factors: [],
          disclaimer: ''
        },
        { complex: true, cache: true }
      );

      this.logger.info('Price prediction complete', {
        symbol,
        direction: result.direction,
        confidence: result.confidence
      });

      return result;
    } catch (error) {
      this.logger.error('Price prediction failed', {
        error: error.message,
        symbol
      });
      throw error;
    }
  }

  // Explain why a stock/crypto moved up or down
  async explainMovement(symbol, changePercent, recentNews = []) {
    const newsContext = recentNews.length > 0
      ? `Recent news:\n${recentNews.slice(0, 5).map(n => `- ${n.title}`).join('\n')}`
      : 'No recent news available';

    const prompt = `Explain why ${symbol} moved ${changePercent > 0 ? 'up' : 'down'} ${Math.abs(changePercent)}% today.

${newsContext}

Provide a clear, concise explanation (2-3 sentences) that a non-expert can understand.
Focus on the most likely reasons based on typical market behavior.`;

    try {
      const explanation = await this.groqClient.generateContent(
        prompt,
        { complex: false, cache: true, maxTokens: 256 }
      );

      this.logger.info('Movement explanation generated', {
        symbol,
        changePercent
      });

      return explanation.trim();
    } catch (error) {
      this.logger.error('Movement explanation failed', {
        error: error.message,
        symbol
      });
      throw error;
    }
  }
}

export default AIMarketService;
