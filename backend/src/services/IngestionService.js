/**
 * Global-Fi Ultra - Document Ingestion Service
 * 
 * Production ingestion pipeline for financial documents:
 * 1. File text extraction (PDF via pdf-parse, TXT, JSON).
 * 2. SHA-256 hash calculation for idempotent deduplication.
 * 3. Section and table-aware financial chunking.
 * 4. Batched vector embedding generation.
 * 5. Atomic persistence to MongoDB (Document & DocumentChunk).
 * 
 * @module services/IngestionService
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PDFParse } from 'pdf-parse';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import { chunkFinancialText, estimateTokens } from '../utils/financialChunker.js';
import { logger } from '../config/logger.js';

export class IngestionService {
  constructor({
    embeddingClient,
    documentModel = Document,
    chunkModel = DocumentChunk,
  } = {}) {
    if (!embeddingClient) {
      throw new Error('EmbeddingClient is required for IngestionService');
    }
    this.embeddingClient = embeddingClient;
    this.documentModel = documentModel;
    this.chunkModel = chunkModel;
    this.logger = logger || console;
  }

  /**
   * Computes SHA-256 hash from a Buffer.
   */
  _computeHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Extracts text from a file buffer based on extension.
   * 
   * @param {Buffer} buffer 
   * @param {string} fileType 
   * @returns {Promise<string>}
   */
  async extractText(buffer, fileType = 'pdf') {
    if (fileType.toLowerCase() === 'pdf') {
      try {
        const parser = new PDFParse(new Uint8Array(buffer));
        await parser.load();
        const result = await parser.getText();
        return result.text || (Array.isArray(result.pages) ? result.pages.map(p => p.text).join('\n\n') : '');
      } catch (err) {
        this.logger.error('PDF parsing error', { error: err.message });
        throw new Error(`Failed to parse PDF document: ${err.message}`);
      }
    } else {
      return buffer.toString('utf-8');
    }
  }

  /**
   * Ingests a file from disk into the vector database.
   * 
   * @param {string} filePath - Path to file on disk
   * @param {object} metadata - Document metadata (title, symbol, filingType, etc.)
   * @returns {Promise<object>} Ingestion summary
   */
  async ingestFile(filePath, metadata = {}) {
    const startTime = Date.now();
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).replace('.', '').toLowerCase() || 'pdf';

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const buffer = fs.readFileSync(filePath);
    const sha256Hash = this._computeHash(buffer);

    // 1. Check if document has already been indexed
    const existing = await this.documentModel.findOne({ sha256Hash });
    if (existing && existing.status === 'indexed') {
      this.logger.info('Document already indexed, skipping re-ingestion', {
        filename,
        documentId: existing._id,
      });
      return {
        documentId: existing._id,
        title: existing.title,
        filename: existing.filename,
        symbol: existing.symbol,
        chunkCount: existing.chunkCount,
        tokenCount: existing.tokenCount,
        status: 'already_indexed',
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Extract plain text
    this.logger.info(`Extracting text from ${filename}...`);
    const fullText = await this.extractText(buffer, ext);
    if (!fullText || fullText.trim().length === 0) {
      throw new Error(`Extracted text is empty for ${filename}`);
    }

    const totalTokens = estimateTokens(fullText);

    // 3. Create or update Document record in pending state
    const docData = {
      title: metadata.title || filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' '),
      filename,
      fileType: ext,
      filePath,
      fileSize: buffer.length,
      sha256Hash,
      source: metadata.source || 'MANUAL_UPLOAD',
      symbol: (metadata.symbol || this._inferSymbolFromFilename(filename)).toUpperCase(),
      filingType: (metadata.filingType || this._inferFilingType(filename)).toUpperCase(),
      filingDate: metadata.filingDate ? new Date(metadata.filingDate) : new Date(),
      status: 'processing',
      tokenCount: totalTokens,
      organizationId: metadata.organizationId || null,
      uploadedBy: metadata.uploadedBy || null,
      isPublic: metadata.isPublic !== undefined ? metadata.isPublic : true,
      metadata: metadata.extra || {},
    };

    const docRecord = existing
      ? await this.documentModel.findByIdAndUpdate(existing._id, docData, { new: true })
      : await this.documentModel.create(docData);

    try {
      // 4. Financial chunking
      const chunks = chunkFinancialText(fullText, {
        targetTokens: 600,
        overlapTokens: 80,
        baseMetadata: {
          title: docRecord.title,
          symbol: docRecord.symbol,
          source: docRecord.source,
          filingType: docRecord.filingType,
          filingDate: docRecord.filingDate,
          organizationId: docRecord.organizationId,
          isPublic: docRecord.isPublic,
        }
      });

      this.logger.info(`Generated ${chunks.length} financial chunks for ${filename}`);

      // 5. Generate embeddings in batches
      const chunkTexts = chunks.map(c => c.content);
      const embeddings = await this.embeddingClient.embedBatch(chunkTexts);

      // Clean old chunks if re-indexing
      await this.chunkModel.deleteMany({ documentId: docRecord._id });

      // 6. Save chunks to MongoDB
      const chunkDocuments = chunks.map((c, idx) => ({
        documentId: docRecord._id,
        chunkIndex: c.chunkIndex,
        content: c.content,
        tokenCount: c.tokenCount,
        embedding: embeddings[idx],
        metadata: c.metadata,
      }));

      await this.chunkModel.insertMany(chunkDocuments);

      // 7. Mark document as indexed
      docRecord.status = 'indexed';
      docRecord.chunkCount = chunkDocuments.length;
      await docRecord.save();

      const durationMs = Date.now() - startTime;
      this.logger.info(`✅ Successfully indexed document: ${filename}`, {
        documentId: docRecord._id,
        chunks: chunkDocuments.length,
        durationMs,
      });

      return {
        documentId: docRecord._id,
        title: docRecord.title,
        filename: docRecord.filename,
        symbol: docRecord.symbol,
        filingType: docRecord.filingType,
        chunkCount: chunkDocuments.length,
        tokenCount: totalTokens,
        status: 'indexed',
        durationMs,
      };
    } catch (err) {
      docRecord.status = 'failed';
      docRecord.errorMessage = err.message;
      await docRecord.save();
      throw err;
    }
  }

  /**
   * Ingests all PDF documents in a directory.
   * 
   * @param {string} dirPath - Directory containing documents
   * @param {object} defaultMetadata
   * @returns {Promise<Array<object>>}
   */
  async ingestDirectory(dirPath, defaultMetadata = {}) {
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }

    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.pdf') || f.endsWith('.txt'));

    this.logger.info(`Found ${files.length} documents to ingest in ${dirPath}`);
    const results = [];

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      try {
        const res = await this.ingestFile(fullPath, defaultMetadata);
        results.push(res);
      } catch (err) {
        this.logger.error(`Failed to ingest file ${file}`, { error: err.message });
        results.push({
          filename: file,
          status: 'failed',
          error: err.message,
        });
      }
    }

    return results;
  }

  /**
   * Heuristic ticker inference from filename.
   */
  _inferSymbolFromFilename(filename) {
    const upper = filename.toUpperCase();
    if (upper.includes('AAPL') || upper.includes('APPLE')) return 'AAPL';
    if (upper.includes('MSFT') || upper.includes('MICROSOFT')) return 'MSFT';
    if (upper.includes('NVDA') || upper.includes('NVIDIA')) return 'NVDA';
    if (upper.includes('TSLA') || upper.includes('TESLA')) return 'TSLA';
    if (upper.includes('FED') || upper.includes('FOMC')) return 'FED';
    if (upper.includes('AMZN') || upper.includes('AMAZON')) return 'AMZN';
    if (upper.includes('GOOG') || upper.includes('ALPHABET')) return 'GOOGL';
    return 'GENERAL';
  }

  /**
   * Heuristic filing type inference.
   */
  _inferFilingType(filename) {
    const upper = filename.toUpperCase();
    if (upper.includes('10-K') || upper.includes('10K') || upper.includes('ANNUAL')) return '10-K';
    if (upper.includes('10-Q') || upper.includes('10Q') || upper.includes('QUARTERLY')) return '10-Q';
    if (upper.includes('8-K') || upper.includes('8K')) return '8-K';
    if (upper.includes('FOMC') || upper.includes('MONETARY')) return 'FOMC';
    return 'REPORT';
  }
}

export default IngestionService;
