/**
 * Global-Fi Ultra - Test RAG Query CLI
 * 
 * Tests the complete Retrieval-Augmented Generation pipeline:
 * Hybrid search -> Reranker -> Groq LLM synthesis -> Exact citations.
 * 
 * Usage:
 *   npm run rag:test
 */

import { connectDatabase, closeDatabaseConnection } from '../src/config/database.js';
import { config } from '../src/config/environment.js';
import { EmbeddingClient } from '../src/infrastructure/ai/EmbeddingClient.js';
import { VectorStore } from '../src/infrastructure/vector/VectorStore.js';
import { RerankerClient } from '../src/infrastructure/ai/RerankerClient.js';
import { SemanticCache } from '../src/infrastructure/cache/SemanticCache.js';
import { GroqClient } from '../src/infrastructure/ai/groqClient.js';
import { RAGService } from '../src/services/RAGService.js';
import { DocumentChunk } from '../src/models/index.js';

async function main() {
  console.log('=====================================================');
  console.log('Global-Fi Ultra - Production RAG Query Test');
  console.log('=====================================================\n');

  await connectDatabase();

  const totalChunks = await DocumentChunk.countDocuments();
  if (totalChunks === 0) {
    console.log('⚠️  No vector chunks found in database. Ingesting sample documents first...\n');
    const { IngestionService } = await import('../src/services/IngestionService.js');
    const { Document } = await import('../src/models/index.js');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const docsDir = path.resolve(__dirname, '..', 'data', 'financial_documents');

    const embeddingClient = new EmbeddingClient({ provider: 'local' });
    const ingestionService = new IngestionService({
      embeddingClient,
      documentModel: Document,
      chunkModel: DocumentChunk,
    });
    await ingestionService.ingestDirectory(docsDir, { source: 'SYSTEM', isPublic: true });
    console.log('✅ Ingestion complete!\n');
  }

  // Initialize RAG components
  const embeddingClient = new EmbeddingClient({
    provider: config.rag?.embeddingProvider || 'local',
    apiKey: config.rag?.embeddingApiKey || '',
    model: config.rag?.embeddingModel || 'Xenova/all-MiniLM-L6-v2',
  });

  let qdrantVectorStore = null;
  if (config.qdrant?.enabled) {
    const { QdrantVectorStore } = await import('../src/infrastructure/vector/QdrantVectorStore.js');
    qdrantVectorStore = new QdrantVectorStore({
      url: config.qdrant.url,
      apiKey: config.qdrant.apiKey,
      collectionName: config.qdrant.collection,
      dimensions: 384,
    });
    await qdrantVectorStore.initialize().catch(() => {});
  }

  const vectorStore = new VectorStore({
    documentChunkModel: DocumentChunk,
    qdrantVectorStore,
    config: config.rag,
  });

  const rerankerClient = new RerankerClient({
    apiKey: config.rag?.cohereApiKey || '',
  });

  const semanticCache = new SemanticCache();

  let groqClient = null;
  const rawApiKey = (config.ai.groqApiKey || '').trim();
  if (rawApiKey.length > 10 && !rawApiKey.includes('your_key')) {
    groqClient = new GroqClient({ apiKey: rawApiKey });
  }

  const ragService = new RAGService({
    groqClient,
    embeddingClient,
    vectorStore,
    rerankerClient,
    semanticCache,
  });

  const testQueries = [
    {
      question: "What were Apple's iPhone and Services revenue numbers in Q3 2024?",
      symbol: "AAPL",
    },
    {
      question: "How fast did Microsoft Azure grow in FY2024 and how much did AI contribute?",
      symbol: "MSFT",
    },
    {
      question: "What drove Nvidia's Data Center revenue growth and what was the gross margin?",
      symbol: "NVDA",
    },
    {
      question: "What were the Federal Reserve FOMC committee findings regarding inflation and jobs?",
      symbol: "FED",
    }
  ];

  for (const q of testQueries) {
    console.log('-----------------------------------------------------');
    console.log(`🔍 QUESTION: "${q.question}" [Symbol: ${q.symbol}]`);
    console.log('-----------------------------------------------------');

    const result = await ragService.query({
      question: q.question,
      symbol: q.symbol,
      topK: 3,
    });

    console.log(`⏱️ Latency: ${result.latencyMs}ms | Confidence: ${result.confidence}% | Cached: ${result.cached}`);
    console.log('\n📝 ANSWER:');
    console.log(result.answer);

    console.log('\n📚 CITATIONS:');
    if (result.citations && result.citations.length > 0) {
      for (const c of result.citations) {
        console.log(`  [Source ${c.sourceId}]: ${c.symbol} (${c.filingType}) • Section: ${c.section} (Page ${c.pageNumber}) • Relevance: ${c.relevanceScore}`);
      }
    } else {
      console.log('  No citations found.');
    }
    console.log('\n');
  }

  console.log('=====================================================');
  console.log('🎉 Production RAG Verification Complete!');
  console.log('=====================================================');

  await closeDatabaseConnection();
  process.exit(0);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
