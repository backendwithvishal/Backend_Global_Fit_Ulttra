/**
 * Global_Fit_Ulttra - Document Chunk Model
 * 
 * Stores semantically chunked text sections from financial documents along with
 * their vector embeddings, financial section identifiers, and metadata.
 * 
 * @module models/DocumentChunk
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const documentChunkSchema = new Schema({
  documentId: {
    type: Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
    index: true,
  },
  chunkIndex: {
    type: Number,
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  tokenCount: {
    type: Number,
    default: 0,
  },
  embedding: {
    type: [Number],
    required: true,
  },
  metadata: {
    title: { type: String, default: '' },
    symbol: { type: String, uppercase: true, default: 'GENERAL', index: true },
    source: { type: String, default: '' },
    filingType: { type: String, uppercase: true, default: 'REPORT', index: true },
    filingDate: { type: Date, default: Date.now, index: true },
    section: { type: String, default: 'General' },
    pageNumber: { type: Number, default: 1 },
    hasTable: { type: Boolean, default: false },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    isPublic: { type: Boolean, default: true, index: true },
  },
}, {
  timestamps: true,
});

// Compound indexes for fast multi-filter retrieval
documentChunkSchema.index({ 'metadata.symbol': 1, 'metadata.filingType': 1 });
documentChunkSchema.index({ documentId: 1, chunkIndex: 1 });
documentChunkSchema.index({ 'metadata.organizationId': 1, 'metadata.isPublic': 1 });

// Text index for sparse keyword / BM25 search
documentChunkSchema.index({ content: 'text' });

export const DocumentChunk = mongoose.model('DocumentChunk', documentChunkSchema);
export default DocumentChunk;
