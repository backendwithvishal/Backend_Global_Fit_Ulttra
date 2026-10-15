// AI stream handler for real-time WebSocket streaming

import { logger } from '../../config/logger.js';

export class AIStreamHandler {
  constructor({ io, groqClient, aiNewsService, aiMarketService, ragService = null }) {
    if (!io) {
      throw new Error('Socket.io server is required');
    }
    if (!groqClient) {
      throw new Error('GroqClient is required');
    }

    this.io = io;
    this.groqClient = groqClient;
    this.aiNewsService = aiNewsService;
    this.aiMarketService = aiMarketService;
    this.ragService = ragService;
    this.logger = logger;

    // Track active streams
    this.activeStreams = new Map();
  }

  initialize() {
    this.io.on('connection', (socket) => {
      this.logger.info('AI client connected', {
        socketId: socket.id,
        clientIp: socket.handshake.address
      });

      socket.on('ai:chat', (data) => this.handleChat(socket, data));
      socket.on('ai:analyze', (data) => this.handleAnalyze(socket, data));
      socket.on('ai:sentiment', (data) => this.handleSentiment(socket, data));
      socket.on('ai:recommend', (data) => this.handleRecommend(socket, data));
      socket.on('ai:rag:query', (data) => this.handleRAGQuery(socket, data));
      socket.on('ai:stream:stop', () => this.handleStopStream(socket));

      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });

    this.logger.info('AI stream handler initialized');
  }

  async handleRAGQuery(socket, data) {
    const { question, symbol, sessionId = 'rag-session' } = data || {};
    if (!question) {
      socket.emit('ai:error', { error: 'Question is required' });
      return;
    }
    if (!this.ragService) {
      socket.emit('ai:error', { error: 'RAG service is unavailable' });
      return;
    }

    this.activeStreams.set(socket.id, true);
    socket.emit('ai:stream:start', { sessionId, type: 'rag' });

    try {
      await this.ragService.streamQuery({
        question,
        symbol,
        onCitations: (citations) => {
          socket.emit('ai:rag:citations', { sessionId, citations });
        },
        onToken: (token) => {
          if (!this.activeStreams.get(socket.id)) {
            throw new Error('Stream stopped by client');
          }
          socket.emit('ai:stream:chunk', { sessionId, chunk: token });
        },
        onComplete: ({ citations }) => {
          socket.emit('ai:stream:complete', { sessionId, citations });
          this.activeStreams.delete(socket.id);
        },
        onError: (err) => {
          socket.emit('ai:stream:error', { sessionId, error: err.message });
          this.activeStreams.delete(socket.id);
        }
      });
    } catch (err) {
      socket.emit('ai:stream:error', { sessionId, error: err.message });
      this.activeStreams.delete(socket.id);
    }
  }

  async handleChat(socket, data) {
    const { message, sessionId } = data;

    if (!message) {
      socket.emit('ai:error', { error: 'Message is required' });
      return;
    }

    this.logger.info('AI chat request', {
      socketId: socket.id,
      sessionId,
      messageLength: message.length
    });

    try {
      this.activeStreams.set(socket.id, true);

      socket.emit('ai:stream:start', { sessionId });

      let fullResponse = '';

      await this.groqClient.streamContent(
        message,
        (chunk) => {
          if (!this.activeStreams.get(socket.id)) {
            throw new Error('Stream stopped by client');
          }

          fullResponse += chunk;
          socket.emit('ai:stream:chunk', {
            sessionId,
            chunk,
            timestamp: Date.now()
          });
        },
        { complex: true }
      );

      socket.emit('ai:stream:complete', {
        sessionId,
        fullResponse,
        timestamp: Date.now()
      });

      this.logger.info('AI chat complete', {
        socketId: socket.id,
        sessionId,
        responseLength: fullResponse.length
      });
    } catch (error) {
      this.logger.error('AI chat failed', {
        error: error.message,
        socketId: socket.id,
        sessionId
      });

      socket.emit('ai:error', {
        sessionId,
        error: error.message
      });
    } finally {
      this.activeStreams.delete(socket.id);
    }
  }

  async handleAnalyze(socket, data) {
    const { symbol, priceData } = data;

    if (!symbol || !priceData) {
      socket.emit('ai:error', { error: 'Symbol and price data are required' });
      return;
    }

    this.logger.info('AI analysis request', {
      socketId: socket.id,
      symbol
    });

    try {
      socket.emit('ai:analyzing', { symbol });

      const analysis = await this.aiMarketService.analyzeAsset(symbol, priceData);

      socket.emit('ai:analysis:complete', {
        symbol,
        analysis,
        timestamp: Date.now()
      });

      this.logger.info('AI analysis complete', {
        socketId: socket.id,
        symbol,
        trend: analysis.trend
      });
    } catch (error) {
      this.logger.error('AI analysis failed', {
        error: error.message,
        socketId: socket.id,
        symbol
      });

      socket.emit('ai:error', {
        symbol,
        error: error.message
      });
    }
  }

  async handleSentiment(socket, data) {
    const { text, type } = data;

    if (!text) {
      socket.emit('ai:error', { error: 'Text is required' });
      return;
    }

    this.logger.info('AI sentiment request', {
      socketId: socket.id,
      type,
      textLength: text.length
    });

    try {
      socket.emit('ai:analyzing', { type: 'sentiment' });

      let result;

      if (type === 'news') {
        result = await this.aiNewsService.analyzeSentiment(text);
      } else {
        const prompt = `Analyze the sentiment of this text: "${text}"
        
Return JSON: { "sentiment": "positive|negative|neutral", "confidence": 85 }`;

        result = await this.groqClient.generateJSON(
          prompt,
          { sentiment: '', confidence: 0 },
          { complex: false }
        );
      }

      socket.emit('ai:sentiment:complete', {
        result,
        timestamp: Date.now()
      });

      this.logger.info('AI sentiment complete', {
        socketId: socket.id,
        sentiment: result.sentiment
      });
    } catch (error) {
      this.logger.error('AI sentiment failed', {
        error: error.message,
        socketId: socket.id
      });

      socket.emit('ai:error', {
        error: error.message
      });
    }
  }

  async handleRecommend(socket, data) {
    const { userProfile, marketData } = data;

    if (!userProfile || !marketData) {
      socket.emit('ai:error', { error: 'User profile and market data are required' });
      return;
    }

    this.logger.info('AI recommendation request', {
      socketId: socket.id,
      riskTolerance: userProfile.riskTolerance
    });

    try {
      socket.emit('ai:analyzing', { type: 'recommendation' });

      const recommendation = await this.aiMarketService.generateRecommendation(
        userProfile,
        marketData
      );

      socket.emit('ai:recommendation:complete', {
        recommendation,
        timestamp: Date.now()
      });

      this.logger.info('AI recommendation complete', {
        socketId: socket.id,
        recommendationsCount: recommendation.recommendations?.length || 0
      });
    } catch (error) {
      this.logger.error('AI recommendation failed', {
        error: error.message,
        socketId: socket.id
      });

      socket.emit('ai:error', {
        error: error.message
      });
    }
  }

  handleStopStream(socket) {
    this.logger.info('AI stream stop requested', {
      socketId: socket.id
    });

    this.activeStreams.set(socket.id, false);
    socket.emit('ai:stream:stopped');
  }

  handleDisconnect(socket) {
    this.logger.info('AI client disconnected', {
      socketId: socket.id
    });

    this.activeStreams.delete(socket.id);
  }

  broadcastInsight(insight) {
    this.io.emit('ai:insight', {
      insight,
      timestamp: Date.now()
    });

    this.logger.info('Market insight broadcasted', {
      type: insight.type,
      clientsCount: this.io.sockets.sockets.size
    });
  }

  getActiveConnections() {
    return this.io.sockets.sockets.size;
  }

  getActiveStreams() {
    return Array.from(this.activeStreams.values()).filter(Boolean).length;
  }
}

export default AIStreamHandler;
