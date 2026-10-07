#!/usr/bin/env node

/**
 * AI Features Demo Script
 * 
 * Demonstrates the AI capabilities of Global-Fi Ultra
 * 
 * Usage: node examples/test-ai-features.js
 */

import { GroqClient } from '../src/infrastructure/ai/groqClient.js';
import { AINewsService } from '../src/services/AINewsService.js';
import { RedisCache } from '../src/infrastructure/cache/RedisCache.js';
import { logger } from '../src/config/logger.js';
import { config } from '../src/config/environment.js';
import { connectRedis } from '../src/config/redis.js';

const runDemo = async () => {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║         Global-Fi Ultra - AI Features Demo               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // Check API key
  if (!config.ai.groqApiKey || config.ai.groqApiKey === '') {
    console.error('❌ Error: GROQ_API_KEY not set in .env file');
    console.log('\n📝 To fix this:');
    console.log('1. Get API key from https://console.groq.com/keys');
    console.log('2. Add to .env file: GROQ_API_KEY=gsk_your_key_here\n');
    process.exit(1);
  }

  try {
    // Connect to Redis
    console.log('🔌 Connecting to Redis...');
    await connectRedis();
    console.log('✅ Redis connected\n');

    // Initialize AI client
    console.log('🤖 Initializing Groq AI client...');
    const groqClient = new GroqClient({
      apiKey: config.ai.groqApiKey,
      cacheService: new RedisCache(),
      logger
    });
    console.log('✅ AI client ready\n');

    // Initialize AI News Service
    const aiNewsService = new AINewsService({
      groqClient,
      cacheService: new RedisCache()
    });

    // Demo 1: Simple sentiment analysis
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Demo 1: Sentiment Analysis (Fast Model - 8B)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const headline = 'Stock market hits all-time high as tech stocks surge';
    console.log(`Analyzing: "${headline}"\n`);

    const sentiment = await aiNewsService.analyzeSentiment(headline);
    console.log('Result:');
    console.log(`  Sentiment: ${sentiment.sentiment}`);
    console.log(`  Confidence: ${sentiment.confidence}%`);
    console.log(`  Reasoning: ${sentiment.reasoning}\n`);

    // Demo 2: Entity extraction
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 Demo 2: Entity Extraction (Fast Model - 8B)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const newsText = 'Apple CEO Tim Cook announced record iPhone sales in China, with revenue up 15% to $95 billion.';
    console.log(`Extracting from: "${newsText}"\n`);

    const entities = await aiNewsService.extractEntities(newsText);
    console.log('Entities found:');
    console.log(`  Companies: ${entities.companies.join(', ') || 'None'}`);
    console.log(`  People: ${entities.people.join(', ') || 'None'}`);
    console.log(`  Locations: ${entities.locations.join(', ') || 'None'}`);
    console.log(`  Metrics: ${entities.metrics.join(', ') || 'None'}\n`);

    // Demo 3: Market impact analysis
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 Demo 3: Market Impact Analysis (Complex Model - 70B)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const newsArticles = [
      { title: 'Fed raises interest rates by 0.25%' },
      { title: 'Tech stocks rally on strong earnings' },
      { title: 'Oil prices surge amid supply concerns' },
      { title: 'Unemployment falls to 3.5%' },
      { title: 'Consumer confidence reaches 5-year high' }
    ];

    console.log('Analyzing news headlines:');
    newsArticles.forEach((article, i) => {
      console.log(`  ${i + 1}. ${article.title}`);
    });
    console.log();

    const impact = await aiNewsService.analyzeMarketImpact(newsArticles);
    console.log('Market Impact:');
    console.log(`  Overall Sentiment: ${impact.overallSentiment}`);
    console.log(`  Confidence: ${impact.confidence}%`);
    console.log(`  Key Themes: ${impact.keyThemes.join(', ')}`);
    console.log(`  Affected Sectors: ${impact.affectedSectors.join(', ')}`);
    console.log(`  Summary: ${impact.summary}\n`);

    // Demo 4: News summary generation
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 Demo 4: News Summary Generation (Fast Model - 8B)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const summaryArticles = [
      {
        title: 'Markets rally on strong jobs report',
        description: 'Unemployment falls to 3.5%, beating expectations'
      },
      {
        title: 'Tech giants report record earnings',
        description: 'Apple, Microsoft, and Google exceed analyst forecasts'
      },
      {
        title: 'Fed signals pause in rate hikes',
        description: 'Central bank indicates rates may hold steady'
      }
    ];

    console.log('Generating summary from 3 articles...\n');

    const summary = await aiNewsService.generateSummary(summaryArticles, 75);
    console.log('Summary:');
    console.log(`  ${summary}\n`);

    // Demo 5: Direct AI query
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💬 Demo 5: Direct AI Query (Complex Model - 70B)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const question = 'Explain the relationship between inflation and stock prices in 2 sentences.';
    console.log(`Question: ${question}\n`);

    const answer = await groqClient.generateContent(question, {
      complex: true,
      maxTokens: 256
    });
    console.log('Answer:');
    console.log(`  ${answer}\n`);

    // Demo 6: Streaming response
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🌊 Demo 6: Streaming Response (Complex Model - 70B)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const streamQuestion = 'What are the top 3 factors affecting cryptocurrency prices?';
    console.log(`Question: ${streamQuestion}\n`);
    console.log('Streaming answer:\n  ');

    await groqClient.streamContent(
      streamQuestion,
      (chunk) => {
        process.stdout.write(chunk);
      },
      { complex: true, maxTokens: 256 }
    );

    console.log('\n');

    // Success
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ All demos completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('💡 Next steps:');
    console.log('  1. Check Redis cache: npm run redis:monitor');
    console.log('  2. Review logs: tail -f logs/app.log');
    console.log('  3. Read docs: docs/AI_FEATURES.md');
    console.log('  4. Build your own AI services!\n');

  } catch (error) {
    console.error('\n❌ Demo failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }

  process.exit(0);
};

// Run demo
runDemo();
