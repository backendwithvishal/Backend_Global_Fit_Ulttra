// AI news analysis - sentiment, entity extraction, market impact
// Uses Groq AI for NLP tasks

import { logger } from '../config/logger.js';

export class AINewsService {
  constructor({ groqClient, cacheService }) {
    if (!groqClient) {
      throw new Error('GroqClient is required');
    }

    this.groqClient = groqClient;
    this.cacheService = cacheService;
    this.logger = logger;
  }

  // Analyze sentiment - positive/negative/neutral with confidence score
  async analyzeSentiment(headline, content = '') {
    const prompt = `Analyze the sentiment of this financial news:

Headline: ${headline}
${content ? `Content: ${content.substring(0, 500)}` : ''}

Classify as: positive, negative, or neutral
Provide confidence score (0-100)
Explain reasoning in one sentence

Return JSON format:
{
  "sentiment": "positive|negative|neutral",
  "confidence": 85,
  "reasoning": "explanation here"
}`;

    try {
      const result = await this.groqClient.generateJSON(
        prompt,
        { sentiment: '', confidence: 0, reasoning: '' },
        { complex: false, cache: true }
      );

      this.logger.info('Sentiment analysis complete', {
        headline: headline.substring(0, 50),
        sentiment: result.sentiment,
        confidence: result.confidence
      });

      return result;
    } catch (error) {
      this.logger.error('Sentiment analysis failed', {
        error: error.message,
        headline: headline.substring(0, 50)
      });
      throw error;
    }
  }

  // Extract companies, people, locations, financial metrics from text
  async extractEntities(text) {
    const prompt = `Extract key financial entities from this text:

${text.substring(0, 1000)}

Identify:
- Companies (stock symbols if mentioned)
- People (executives, analysts)
- Locations (markets, countries)
- Financial metrics (prices, percentages)

Return JSON format:
{
  "companies": ["AAPL", "MSFT"],
  "people": ["Tim Cook"],
  "locations": ["US", "China"],
  "metrics": ["$150", "5%"]
}`;

    try {
      const result = await this.groqClient.generateJSON(
        prompt,
        { companies: [], people: [], locations: [], metrics: [] },
        { complex: false, cache: true }
      );

      this.logger.info('Entity extraction complete', {
        companiesFound: result.companies?.length || 0,
        peopleFound: result.people?.length || 0
      });

      return result;
    } catch (error) {
      this.logger.error('Entity extraction failed', {
        error: error.message
      });
      throw error;
    }
  }

  // Analyze market impact of news - sentiment, themes, affected sectors
  async analyzeMarketImpact(newsArticles) {
    if (!newsArticles || newsArticles.length === 0) {
      return {
        overallSentiment: 'neutral',
        confidence: 0,
        keyThemes: [],
        affectedSectors: [],
        summary: 'No news to analyze'
      };
    }

    // Prepare news summary
    const newsSummary = newsArticles
      .slice(0, 10) // Limit to 10 articles
      .map((article, i) => `${i + 1}. ${article.title}`)
      .join('\n');

    const prompt = `Analyze the market impact of these recent financial news headlines:

${newsSummary}

Provide:
1. Overall market sentiment (positive/negative/neutral)
2. Confidence score (0-100)
3. Key themes (3-5 main topics)
4. Affected sectors (e.g., tech, energy, finance)
5. Brief summary (2-3 sentences)

Return JSON format:
{
  "overallSentiment": "positive|negative|neutral",
  "confidence": 75,
  "keyThemes": ["interest rates", "tech earnings"],
  "affectedSectors": ["technology", "finance"],
  "summary": "Market shows positive sentiment..."
}`;

    try {
      const result = await this.groqClient.generateJSON(
        prompt,
        {
          overallSentiment: '',
          confidence: 0,
          keyThemes: [],
          affectedSectors: [],
          summary: ''
        },
        { complex: true, cache: true }
      );

      this.logger.info('Market impact analysis complete', {
        articlesAnalyzed: newsArticles.length,
        sentiment: result.overallSentiment,
        confidence: result.confidence
      });

      return result;
    } catch (error) {
      this.logger.error('Market impact analysis failed', {
        error: error.message,
        articlesCount: newsArticles.length
      });
      throw error;
    }
  }

  // Generate concise summary of multiple news articles
  async generateSummary(newsArticles, maxLength = 100) {
    if (!newsArticles || newsArticles.length === 0) {
      return 'No news available';
    }

    const newsText = newsArticles
      .slice(0, 5)
      .map(article => `${article.title}: ${article.description || ''}`)
      .join('\n\n');

    const prompt = `Summarize these financial news articles in ${maxLength} words or less:

${newsText}

Focus on:
- Key market movements
- Important company news
- Economic indicators
- Overall market sentiment

Provide a concise, professional summary.`;

    try {
      const summary = await this.groqClient.generateContent(
        prompt,
        { complex: false, cache: true, maxTokens: 256 }
      );

      this.logger.info('News summary generated', {
        articlesCount: newsArticles.length,
        summaryLength: summary.length
      });

      return summary.trim();
    } catch (error) {
      this.logger.error('Summary generation failed', {
        error: error.message
      });
      throw error;
    }
  }

  // Analyze sentiment trend over time - improving/declining/stable
  async analyzeSentimentTrend(historicalNews) {
    const prompt = `Analyze the sentiment trend in these financial news headlines over time:

${JSON.stringify(historicalNews, null, 2)}

Identify:
1. Overall trend (improving/declining/stable)
2. Key turning points
3. Confidence in trend (0-100)
4. Brief explanation

Return JSON format:
{
  "trend": "improving|declining|stable",
  "turningPoints": ["date: reason"],
  "confidence": 80,
  "explanation": "Sentiment has been..."
}`;

    try {
      const result = await this.groqClient.generateJSON(
        prompt,
        {
          trend: '',
          turningPoints: [],
          confidence: 0,
          explanation: ''
        },
        { complex: true, cache: true }
      );

      this.logger.info('Sentiment trend analysis complete', {
        trend: result.trend,
        confidence: result.confidence
      });

      return result;
    } catch (error) {
      this.logger.error('Sentiment trend analysis failed', {
        error: error.message
      });
      throw error;
    }
  }
}

export default AINewsService;
