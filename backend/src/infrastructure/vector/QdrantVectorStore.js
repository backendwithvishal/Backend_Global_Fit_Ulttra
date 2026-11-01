/**
 * Global_Fit_Ulttra - Qdrant Vector Store
 * 
 * Production-ready dedicated vector storage and retrieval manager using Qdrant.
 * Supports:
 * 1. Configurable connection modes (Local Docker / Hosted Qdrant Cloud)
 * 2. Idempotent collection initialization with Cosine distance
 * 3. Payload indexing for fast multi-tenant filtering (symbol, filingType, organizationId, isPublic)
 * 4. Deterministic point IDs generated from documentId and chunkIndex
 * 5. Batch upserts with payload persistence
 * 6. Health checks and index version tracking
 * 7. Graceful offline detection
 * 
 * @module infrastructure/vector/QdrantVectorStore
 */

import crypto from 'crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { logger } from '../../config/logger.js';

export class QdrantVectorStore {
  constructor({
    url = 'http://localhost:6333',
    apiKey = '',
    collectionName = 'global_fit_ulttra_financial_documents',
    dimensions = 384,
  } = {}) {
    this.url = url || 'http://localhost:6333';
    this.apiKey = apiKey || '';
    this.collectionName = collectionName || 'global_fit_ulttra_financial_documents';
    this.dimensions = dimensions || 384;
    this.logger = logger || console;
    this.isReady = false;

    this.client = new QdrantClient({
      url: this.url,
      apiKey: this.apiKey || undefined,
      checkCompatibility: false,
    });
  }

  /**
   * Generates a deterministic UUID from documentId and chunkIndex.
   * Ensures idempotent upserts across re-indexing runs.
   * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx (RFC 4122 v4-compliant string)
   */
  _generatePointId(documentId, chunkIndex) {
    const raw = `${documentId || 'doc'}:${chunkIndex !== undefined ? chunkIndex : 0}`;
    const hash = crypto.createHash('md5').update(raw).digest('hex');
    return [
      hash.slice(0, 8),
      hash.slice(8, 12),
      '4' + hash.slice(13, 16),
      ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.slice(18, 20),
      hash.slice(20, 32)
    ].join('-');
  }

  /**
   * Initializes and validates Qdrant collection and payload indexes.
   * @returns {Promise<boolean>} True if initialized, false if Qdrant is unreachable
   */
  async initialize() {
    try {
      // 1. Health check / server ping
      const collections = await this.client.getCollections();
      const existing = (collections.collections || []).some(c => c.name === this.collectionName);

      if (!existing) {
        this.logger.info(`Creating Qdrant collection '${this.collectionName}' (${this.dimensions} dims, Cosine)...`);
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this.dimensions,
            distance: 'Cosine',
          },
          optimizers_config: {
            default_segment_number: 2,
          },
          replication_factor: 1,
        });

        // 2. Create payload indexes for frequent filters
        const indexesToCreate = [
          { field_name: 'symbol', field_schema: 'keyword' },
          { field_name: 'filingType', field_schema: 'keyword' },
          { field_name: 'organizationId', field_schema: 'keyword' },
          { field_name: 'isPublic', field_schema: 'bool' },
          { field_name: 'documentId', field_schema: 'keyword' },
        ];

        for (const idx of indexesToCreate) {
          try {
            await this.client.createPayloadIndex(this.collectionName, idx);
          } catch (err) {
            this.logger.debug(`Payload index creation note: ${err.message}`);
          }
        }
        this.logger.info(`✅ Qdrant collection '${this.collectionName}' created with payload indexes`);
      } else {
        this.logger.info(`✅ Qdrant collection '${this.collectionName}' exists and is ready`);
      }

      this.isReady = true;
      return true;
    } catch (err) {
      this.isReady = false;
      this.logger.warn('⚠️ Qdrant is unreachable or not configured. Vector operations will use MongoDB fallback.', {
        url: this.url,
        error: err.message,
      });
      return false;
    }
  }

  /**
   * Upserts document chunks into Qdrant in batches.
   * 
   * @param {Array<object>} chunks - Array of chunk records
   * @returns {Promise<number>} Number of points successfully upserted
   */
  async upsertChunks(chunks) {
    if (!this.isReady || !Array.isArray(chunks) || chunks.length === 0) {
      return 0;
    }

    const points = chunks.map(chunk => {
      const docId = chunk.documentId ? chunk.documentId.toString() : 'unknown';
      const chunkIdx = chunk.chunkIndex !== undefined ? chunk.chunkIndex : 0;
      const pointId = this._generatePointId(docId, chunkIdx);
      const meta = chunk.metadata || {};

      return {
        id: pointId,
        vector: chunk.embedding,
        payload: {
          documentId: docId,
          chunkIndex: chunkIdx,
          content: chunk.content || '',
          tokenCount: chunk.tokenCount || 0,
          symbol: (meta.symbol || 'GENERAL').toUpperCase(),
          filingType: (meta.filingType || 'REPORT').toUpperCase(),
          title: meta.title || '',
          section: meta.section || 'General',
          pageNumber: meta.pageNumber || 1,
          hasTable: !!meta.hasTable,
          organizationId: meta.organizationId ? meta.organizationId.toString() : null,
          isPublic: meta.isPublic !== undefined ? meta.isPublic : true,
          filingDate: meta.filingDate ? new Date(meta.filingDate).toISOString() : new Date().toISOString(),
        },
      };
    });

    const batchSize = 64;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      await this.client.upsert(this.collectionName, {
        wait: true,
        points: batch,
      });
    }

    this.logger.info(`Indexed ${points.length} points into Qdrant collection '${this.collectionName}'`);
    return points.length;
  }

  /**
   * Executes Dense Semantic Vector Search in Qdrant.
   * 
   * @param {number[]} queryEmbedding - 384-dimensional dense vector
   * @param {object} options - Search options (filter, limit)
   * @returns {Promise<Array<{ chunk: object, score: number }>>}
   */
  async searchDense(queryEmbedding, options = {}) {
    if (!this.isReady) {
      return null;
    }

    const { filter = {}, limit = 20 } = options;

    // Build Qdrant filter
    const mustConditions = [];
    const shouldConditions = [];

    if (filter.symbol && filter.symbol !== 'ALL') {
      mustConditions.push({
        key: 'symbol',
        match: { value: filter.symbol.toUpperCase() },
      });
    }

    if (filter.filingType && filter.filingType !== 'ALL') {
      mustConditions.push({
        key: 'filingType',
        match: { value: filter.filingType.toUpperCase() },
      });
    }

    // Access control: Organization isolation or public
    if (filter.organizationId) {
      shouldConditions.push(
        { key: 'organizationId', match: { value: filter.organizationId.toString() } },
        { key: 'isPublic', match: { value: true } }
      );
    } else {
      mustConditions.push({
        key: 'isPublic',
        match: { value: filter.isPublic !== undefined ? filter.isPublic : true },
      });
    }

    const qdrantFilter = {};
    if (mustConditions.length > 0) qdrantFilter.must = mustConditions;
    if (shouldConditions.length > 0) qdrantFilter.should = shouldConditions;

    try {
      const searchResults = await this.client.search(this.collectionName, {
        vector: queryEmbedding,
        limit,
        filter: Object.keys(qdrantFilter).length > 0 ? qdrantFilter : undefined,
        with_payload: true,
      });

      return searchResults.map(item => ({
        chunk: {
          _id: item.id,
          documentId: item.payload?.documentId,
          chunkIndex: item.payload?.chunkIndex,
          content: item.payload?.content,
          metadata: {
            title: item.payload?.title,
            symbol: item.payload?.symbol,
            filingType: item.payload?.filingType,
            section: item.payload?.section,
            pageNumber: item.payload?.pageNumber,
            hasTable: item.payload?.hasTable,
            organizationId: item.payload?.organizationId,
            isPublic: item.payload?.isPublic,
            filingDate: item.payload?.filingDate,
          },
        },
        score: item.score || 0,
      }));
    } catch (err) {
      this.logger.warn('Qdrant dense search failed, delegating to fallback', { error: err.message });
      return null;
    }
  }

  /**
   * Deletes all points belonging to a document ID.
   * @param {string} documentId
   */
  async deleteByDocumentId(documentId) {
    if (!this.isReady || !documentId) return;

    try {
      await this.client.delete(this.collectionName, {
        filter: {
          must: [
            { key: 'documentId', match: { value: documentId.toString() } },
          ],
        },
      });
      this.logger.info(`Deleted points for documentId ${documentId} from Qdrant`);
    } catch (err) {
      this.logger.warn(`Failed to delete points for documentId ${documentId} in Qdrant`, { error: err.message });
    }
  }

  /**
   * Returns current health and statistics of the Qdrant connection.
   */
  async checkHealth() {
    if (!this.isReady) {
      return {
        status: 'unreachable',
        provider: 'qdrant',
        url: this.url,
        collection: this.collectionName,
      };
    }

    try {
      const info = await this.client.getCollection(this.collectionName);
      return {
        status: 'healthy',
        provider: 'qdrant',
        url: this.url,
        collection: this.collectionName,
        pointsCount: info.points_count || 0,
        vectorsCount: info.vectors_count || 0,
        status_info: info.status,
      };
    } catch (err) {
      return {
        status: 'error',
        provider: 'qdrant',
        error: err.message,
      };
    }
  }
}

export default QdrantVectorStore;
