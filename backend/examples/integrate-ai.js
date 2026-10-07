#!/usr/bin/env node

/**
 * AI Integration Example
 * 
 * Shows how to integrate AI features into your Express app
 * 
 * Usage: node examples/integrate-ai.js
 */

import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';

// Import AI infrastructure
import { GroqClient } from '../src/infrastructure/ai/groqClient.js';
import { AINewsService } from '../src/services/AINewsService.js';
import { AIMarketService } from '../src/services/AIMarketService.js';
import { AIStreamHandler } from '../src/infrastructure/websocket/AIStreamHandler.js';
import { AIJobQueue } from '../src/infrastructure/messaging/AIJobQueue.js';
import { AIController } from '../src/controllers/AIController.js';
import { createAIRoutes } from '../src/routes/aiRoutes.js';

// Import existing infrastructure
import { RedisCache } from '../src/infrastructure/cache/RedisCache.js';
import { connectRedis } from '../src/config/redis.js';
import { logger } from '../src/config/logger.js';
import { config } from '../src/config/environment.js';

/**
 * Initialize AI services
 */
const initializeAI = async () => {
  logger.info('Initializing AI services...');

  // Connect to Redis
  await connectRedis();

  // Initialize cache
  const cacheService = new RedisCache();

  // Initialize Groq client
  const groqClient = new GroqClient({
    apiKey: config.ai.groqApiKey,
    cacheService,
    logger
  });

  // Validate API key
  try {
    await groqClient.validateApiKey();
    logger.info('✅ Groq API key validated');
  } catch (error) {
    logger.error('❌ Invalid Groq API key');
    throw error;
  }

  // Initialize AI services
  const aiNewsService = new AINewsService({
    groqClient,
    cacheService
  });

  const aiMarketService = new AIMarketService({
    groqClient,
    cacheService
  });

  // Initialize job queue (optional)
  let aiJobQueue = null;
  try {
    aiJobQueue = new AIJobQueue({
      aiNewsService,
      aiMarketService
    });
    await aiJobQueue.connect();
    await aiJobQueue.startConsumers();
    logger.info('✅ RabbitMQ job queue initialized');
  } catch (error) {
    logger.warn('⚠️  RabbitMQ not available, job queue disabled', {
      error: error.message
    });
  }

  return {
    groqClient,
    aiNewsService,
    aiMarketService,
    aiJobQueue,
    cacheService
  };
};

/**
 * Setup Express app with AI routes
 */
const setupApp = (aiServices) => {
  const app = express();
  const httpServer = createServer(app);

  // Middleware
  app.use(express.json());

  // Initialize Socket.io
  const io = new Server(httpServer, {
    cors: {
      origin: config.security.corsOrigins,
      methods: ['GET', 'POST']
    }
  });

  // Initialize AI stream handler
  const aiStreamHandler = new AIStreamHandler({
    io,
    groqClient: aiServices.groqClient,
    aiNewsService: aiServices.aiNewsService,
    aiMarketService: aiServices.aiMarketService
  });
  aiStreamHandler.initialize();

  // Initialize AI controller
  const aiController = new AIController({
    aiNewsService: aiServices.aiNewsService,
    aiMarketService: aiServices.aiMarketService,
    aiJobQueue: aiServices.aiJobQueue
  });

  // Mount AI routes
  app.use('/api/v1/ai', createAIRoutes(aiController));

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      ai: {
        enabled: true,
        groqConnected: true,
        jobQueueEnabled: aiServices.aiJobQueue !== null,
        websocketConnections: aiStreamHandler.getActiveConnections()
      }
    });
  });

  // Example: Periodic market insights broadcast
  setInterval(async () => {
    try {
      const insight = {
        type: 'market_pulse',
        message: 'Market analysis updated',
        timestamp: Date.now()
      };

      aiStreamHandler.broadcastInsight(insight);
    } catch (error) {
      logger.error('Failed to broadcast insight', { error: error.message });
    }
  }, 60000); // Every minute

  return { app, httpServer, io, aiStreamHandler };
};

/**
 * Main function
 */
const main = async () => {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║         Global-Fi Ultra - AI Integration Example         ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  try {
    // Initialize AI services
    const aiServices = await initializeAI();

    // Setup Express app
    const { app, httpServer, aiStreamHandler } = setupApp(aiServices);

    // Start server
    const PORT = process.env.PORT || 3000;
    httpServer.listen(PORT, () => {
      console.log('\n✅ Server started successfully!\n');
      console.log(`🌐 HTTP Server: http://localhost:${PORT}`);
      console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
      console.log('\n📚 Available AI Endpoints:\n');
      console.log('  POST /api/v1/ai/sentiment       - Analyze sentiment');
      console.log('  POST /api/v1/ai/analyze         - Analyze asset');
      console.log('  POST /api/v1/ai/compare         - Compare assets');
      console.log('  POST /api/v1/ai/recommend       - Get recommendations');
      console.log('  POST /api/v1/ai/portfolio       - Analyze portfolio');
      console.log('  POST /api/v1/ai/predict         - Predict price');
      console.log('  POST /api/v1/ai/explain         - Explain movement');
      console.log('  POST /api/v1/ai/news/impact     - Analyze news impact');
      console.log('  POST /api/v1/ai/news/summary    - Generate summary');
      console.log('  POST /api/v1/ai/jobs            - Submit async job');
      console.log('  GET  /api/v1/ai/jobs/stats      - Get queue stats');
      console.log('\n🔌 WebSocket Events:\n');
      console.log('  ai:chat                         - Chat with AI (streaming)');
      console.log('  ai:analyze                      - Analyze asset');
      console.log('  ai:sentiment                    - Analyze sentiment');
      console.log('  ai:recommend                    - Get recommendations');
      console.log('  ai:stream:stop                  - Stop streaming');
      console.log('\n💡 Example Requests:\n');
      console.log('  # Analyze sentiment');
      console.log('  curl -X POST http://localhost:3000/api/v1/ai/sentiment \\');
      console.log('    -H "Content-Type: application/json" \\');
      console.log('    -d \'{"text":"Stock market hits all-time high"}\'');
      console.log('\n  # Analyze asset');
      console.log('  curl -X POST http://localhost:3000/api/v1/ai/analyze \\');
      console.log('    -H "Content-Type: application/json" \\');
      console.log('    -d \'{"symbol":"AAPL","priceData":{"current":150,"change24h":2.5}}\'');
      console.log('\n  # WebSocket chat (JavaScript)');
      console.log('  const socket = io("http://localhost:3000");');
      console.log('  socket.emit("ai:chat", { message: "Explain inflation", sessionId: "123" });');
      console.log('  socket.on("ai:stream:chunk", (data) => console.log(data.chunk));');
      console.log('\n📊 Monitor Redis cache:');
      console.log('  npm run redis:monitor\n');
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n\n⚠️  Shutting down gracefully...\n');

      httpServer.close(() => {
        console.log('✅ HTTP server closed');
      });

      if (aiServices.aiJobQueue) {
        await aiServices.aiJobQueue.close();
        console.log('✅ Job queue closed');
      }

      console.log('✅ Shutdown complete\n');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('\n❌ Failed to start server:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
};

// Run
main();
