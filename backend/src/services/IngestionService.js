/**
 * Global-Fi Ultra - Document Ingestion Service
 * 
 * Production ingestion pipeline for financial documents:
 * 1. File text extraction (PDF via pdf-parse, TXT, JSON, MD).
 * 2. Path validation & traversal protection against untrusted file paths.
 * 3. SHA-256 hash calculation for idempotent deduplication.
 * 4. Section and table-aware financial chunking.
 * 5. Batched vector embedding generation with genuine semantic models.
 * 6. Dual persistence: MongoDB (documents & chunks) and Qdrant (points & payloads).
 * 7. Safe re-indexing and idempotent cleanup.
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
    vectorStore = null,
    documentModel = Document,
    chunkModel = DocumentChunk,
  } = {}) {
    if (!embeddingClient) {
      throw new Error('EmbeddingClient is required for IngestionService');
    }
    this.embeddingClient = embeddingClient;
    this.vectorStore = vectorStore;
    this.documentModel = documentModel;
    this.chunkModel = chunkModel;
    this.logger = logger || console;
  }

  /**
   * Sanitizes and validates file path against directory traversal and null byte injections.
   * @param {string} inputPath 
   * @returns {string} Normalized absolute path
   */
  _validateAndResolvePath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
      throw new Error('Invalid file path provided');
    }

    // Guard against null byte injections
    if (inputPath.includes('\0')) {
      throw new Error('Invalid file path: Null byte detected');
    }

    const resolved = path.resolve(inputPath);

    // Guard against directory traversal attacks outside authorized project workspace
    const cwd = path.resolve(process.cwd());
    const projectRoot = path.resolve(cwd, '..');
    const resolvedLower = resolved.toLowerCase();
    const isInsideProject = resolvedLower.startsWith(cwd.toLowerCase()) || resolvedLower.startsWith(projectRoot.toLowerCase());
    if (!isInsideProject) {
      throw new Error(`Access denied: File path outside authorized repository directory: ${resolved}`);
    }

    // Ensure file exists
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${resolved}`);
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      throw new Error(`Path is not a regular file: ${resolved}`);
    }

    return resolved;
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
   * @param {string} rawFilePath - Path to file on disk
   * @param {object} metadata - Document metadata (title, symbol, filingType, etc.)
   * @returns {Promise<object>} Ingestion summary
   */
  async ingestFile(rawFilePath, metadata = {}) {
    const startTime = Date.now();
    const filePath = this._validateAndResolvePath(rawFilePath);
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).replace('.', '').toLowerCase() || 'pdf';

    const buffer = fs.readFileSync(filePath);
    const sha256Hash = this._computeHash(buffer);

    // 1. Check if document has already been indexed (Idempotency)
    const existing = await this.documentModel.findOne({ sha256Hash });
    if (existing && existing.status === 'indexed' && !metadata.forceReindex) {
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

    // 3. Create or update Document record in processing state
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

      // Clean old chunks from MongoDB & Qdrant if re-indexing
      await this.chunkModel.deleteMany({ documentId: docRecord._id });
      if (this.vectorStore) {
        await this.vectorStore.deleteByDocumentId(docRecord._id);
      }

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

      // 7. Also index chunks into dedicated Qdrant store if available
      if (this.vectorStore) {
        await this.vectorStore.indexChunks(chunkDocuments);
      }

      // 8. Mark document as indexed
      docRecord.status = 'indexed';
      docRecord.chunkCount = chunkDocuments.length;
      docRecord.errorMessage = null;
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
   * Ingests all PDF and text documents in a directory.
   * 
   * @param {string} rawDirPath - Directory containing documents
   * @param {object} defaultMetadata
   * @returns {Promise<Array<object>>}
   */
  async ingestDirectory(rawDirPath, defaultMetadata = {}) {
    const dirPath = path.resolve(rawDirPath);
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }

    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.pdf') || f.endsWith('.txt') || f.endsWith('.json') || f.endsWith('.md'));

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
   * Re-indexes all existing documents in MongoDB.
   * Useful when changing embedding models or re-chunking documents.
   */
  async reindexAll() {
    const documents = await this.documentModel.find({ filePath: { $ne: null } });
    this.logger.info(`Re-indexing ${documents.length} existing documents...`);
    const results = [];

    for (const doc of documents) {
      try {
        if (doc.filePath && fs.existsSync(doc.filePath)) {
          const res = await this.ingestFile(doc.filePath, {
            title: doc.title,
            symbol: doc.symbol,
            filingType: doc.filingType,
            organizationId: doc.organizationId,
            isPublic: doc.isPublic,
            forceReindex: true,
          });
          results.push(res);
        }
      } catch (err) {
        results.push({
          documentId: doc._id,
          filename: doc.filename,
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
