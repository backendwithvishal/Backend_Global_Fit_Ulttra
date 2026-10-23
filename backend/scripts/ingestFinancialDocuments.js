/**
 * Global_Fit_Ulttra - Ingest Financial Documents CLI
 * 
 * Command-line script to ingest and vectorize all financial PDF filings
 * and macroeconomic reports stored in `data/financial_documents/`.
 * 
 * Usage:
 *   npm run rag:ingest
 */

import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { config } from '../src/config/environment.js';
import { logger } from '../src/config/logger.js';
import { connectDatabase, closeDatabaseConnection } from '../src/config/database.js';
import { EmbeddingClient } from '../src/infrastructure/ai/EmbeddingClient.js';
import { IngestionService } from '../src/services/IngestionService.js';
import { Document, DocumentChunk } from '../src/models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.resolve(__dirname, '..', 'data', 'financial_documents');

async function main() {
  console.log('=====================================================');
  console.log('Global_Fit_Ulttra - Financial RAG Document Ingestion');
  console.log('=====================================================');

  try {
    console.log(`Connecting to MongoDB (${config.database.uri})...`);
    await connectDatabase();
    console.log('✅ Connected to MongoDB\n');

    console.log('Initializing EmbeddingClient, VectorStore & IngestionService...');
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

    const { VectorStore } = await import('../src/infrastructure/vector/VectorStore.js');
    const vectorStore = new VectorStore({
      documentChunkModel: DocumentChunk,
      qdrantVectorStore,
      config: config.rag,
    });

    const ingestionService = new IngestionService({
      embeddingClient,
      vectorStore,
      documentModel: Document,
      chunkModel: DocumentChunk,
    });

    console.log(`Scanning financial document repository at:\n${docsDir}\n`);
    const results = await ingestionService.ingestDirectory(docsDir, {
      source: 'SYSTEM',
      isPublic: true,
    });

    console.log('-----------------------------------------------------');
    console.log('Ingestion Summary:');
    console.log('-----------------------------------------------------');
    for (const r of results) {
      if (r.status === 'indexed') {
        console.log(`✅ [${r.symbol || 'GENERAL'}] ${r.filename}: ${r.chunkCount} chunks, ~${r.tokenCount} tokens (${r.durationMs}ms)`);
      } else if (r.status === 'already_indexed') {
        console.log(`⏩ [${r.symbol || 'GENERAL'}] ${r.filename}: Already indexed (${r.chunkCount} chunks)`);
      } else {
        console.log(`❌ ${r.filename}: Failed - ${r.error}`);
      }
    }

    const totalDocs = await Document.countDocuments({ status: 'indexed' });
    const totalChunks = await DocumentChunk.countDocuments();
    console.log('-----------------------------------------------------');
    console.log(`Total Indexed Documents in Repository: ${totalDocs}`);
    console.log(`Total Indexed Vector Chunks: ${totalChunks}`);
    console.log('=====================================================\n');
    console.log('🎉 Financial knowledge repository is ready for RAG queries!');
  } catch (err) {
    console.error('❌ Ingestion failed:', err.message);
  } finally {
    await closeDatabaseConnection();
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
