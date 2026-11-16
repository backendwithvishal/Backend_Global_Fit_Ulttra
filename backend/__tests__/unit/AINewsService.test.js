/**
 * AI News Service Tests
 * 
 * @jest-environment node
 */

import { jest } from '@jest/globals';

// Mock logger to prevent real config/winston initialization during tests
jest.unstable_mockModule('../../src/config/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const { AINewsService } = await import('../../src/services/AINewsService.js');

describe('AINewsService', () => {
  let service;
  let mockGroqClient;
  let mockCacheService;

  beforeEach(() => {
    // Mock Groq client
    mockGroqClient = {
      generateContent: jest.fn(),
      generateJSON: jest.fn()
    };

    // Mock cache service
    mockCacheService = {
      get: jest.fn(),
      set: jest.fn()
    };

    // Initialize service with mocks
    service = new AINewsService({
      groqClient: mockGroqClient,
      cacheService: mockCacheService
    });
  });

  describe('analyzeSentiment', () => {
    it('should analyze sentiment of news article', async () => {
      // Arrange
      const headline = 'Stock market hits record high';
      const expectedResult = {
        sentiment: 'positive',
        confidence: 85,
        reasoning: 'Record high indicates strong market performance'
      };

      mockGroqClient.generateJSON.mockResolvedValue(expectedResult);

      // Act
      const result = await service.analyzeSentiment(headline);

      // Assert
      expect(result).toEqual(expectedResult);
      expect(mockGroqClient.generateJSON).toHaveBeenCalledWith(
        expect.stringContaining(headline),
        expect.any(Object),
        expect.objectContaining({ complex: false, cache: true })
      );
    });

    it('should throw error when LLM generation fails instead of returning fake neutral', async () => {
      // Arrange
      mockGroqClient.generateJSON.mockRejectedValue(new Error('API error'));

      // Act & Assert
      await expect(service.analyzeSentiment('Test headline')).rejects.toThrow('API error');
    });
  });

  describe('extractEntities', () => {
    it('should extract entities from text', async () => {
      // Arrange
      const text = 'Apple CEO Tim Cook announced new iPhone in US market';
      const expectedResult = {
        companies: ['AAPL'],
        people: ['Tim Cook'],
        locations: ['US'],
        metrics: []
      };

      mockGroqClient.generateJSON.mockResolvedValue(expectedResult);

      // Act
      const result = await service.extractEntities(text);

      // Assert
      expect(result).toEqual(expectedResult);
      expect(result.companies).toContain('AAPL');
      expect(result.people).toContain('Tim Cook');
    });

    it('should throw error when entity extraction fails', async () => {
      // Arrange
      mockGroqClient.generateJSON.mockRejectedValue(new Error('API error'));

      // Act & Assert
      await expect(service.extractEntities('Test text')).rejects.toThrow('API error');
    });
  });

  describe('analyzeMarketImpact', () => {
    it('should analyze market impact of news articles', async () => {
      // Arrange
      const newsArticles = [
        { title: 'Tech stocks surge on earnings' },
        { title: 'Fed holds interest rates steady' }
      ];

      const expectedResult = {
        overallSentiment: 'positive',
        confidence: 75,
        keyThemes: ['tech earnings', 'interest rates'],
        affectedSectors: ['technology', 'finance'],
        summary: 'Market shows positive sentiment driven by tech earnings'
      };

      mockGroqClient.generateJSON.mockResolvedValue(expectedResult);

      // Act
      const result = await service.analyzeMarketImpact(newsArticles);

      // Assert
      expect(result.overallSentiment).toBe('positive');
      expect(result.keyThemes).toContain('tech earnings');
      expect(result.affectedSectors).toContain('technology');
    });

    it('should handle empty news array', async () => {
      // Act
      const result = await service.analyzeMarketImpact([]);

      // Assert
      expect(result.overallSentiment).toBe('neutral');
      expect(result.confidence).toBe(0);
      expect(mockGroqClient.generateJSON).not.toHaveBeenCalled();
    });
  });

  describe('generateSummary', () => {
    it('should generate news summary', async () => {
      // Arrange
      const newsArticles = [
        {
          title: 'Market rallies on strong jobs report',
          description: 'Unemployment falls to 3.5%'
        }
      ];

      const expectedSummary = 'Markets rallied today following a strong jobs report showing unemployment at 3.5%.';

      mockGroqClient.generateContent.mockResolvedValue(expectedSummary);

      // Act
      const result = await service.generateSummary(newsArticles);

      // Assert
      expect(result).toBe(expectedSummary);
      expect(mockGroqClient.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('Summarize'),
        expect.objectContaining({ complex: false, cache: true })
      );
    });

    it('should handle empty news array', async () => {
      // Act
      const result = await service.generateSummary([]);

      // Assert
      expect(result).toBe('No news available');
      expect(mockGroqClient.generateContent).not.toHaveBeenCalled();
    });
  });

  describe('analyzeSentimentTrend', () => {
    it('should analyze sentiment trend over time', async () => {
      // Arrange
      const historicalNews = [
        { date: '2024-01-01', sentiment: 'positive' },
        { date: '2024-01-02', sentiment: 'neutral' }
      ];

      const expectedResult = {
        trend: 'declining',
        turningPoints: ['2024-01-02: Market uncertainty increased'],
        confidence: 70,
        explanation: 'Sentiment declined from positive to neutral'
      };

      mockGroqClient.generateJSON.mockResolvedValue(expectedResult);

      // Act
      const result = await service.analyzeSentimentTrend(historicalNews);

      // Assert
      expect(result.trend).toBe('declining');
      expect(result.confidence).toBe(70);
      expect(mockGroqClient.generateJSON).toHaveBeenCalledWith(
        expect.stringContaining('sentiment trend'),
        expect.any(Object),
        expect.objectContaining({ complex: true })
      );
    });
  });

  describe('constructor', () => {
    it('should throw error if groqClient is missing', () => {
      // Act & Assert
      expect(() => {
        new AINewsService({ cacheService: mockCacheService });
      }).toThrow('GroqClient is required');
    });

    it('should initialize with valid dependencies', () => {
      // Act
      const newService = new AINewsService({
        groqClient: mockGroqClient,
        cacheService: mockCacheService
      });

      // Assert
      expect(newService.groqClient).toBe(mockGroqClient);
      expect(newService.cacheService).toBe(mockCacheService);
    });
  });
});
