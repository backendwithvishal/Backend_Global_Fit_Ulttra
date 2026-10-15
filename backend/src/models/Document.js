/**
 * Global-Fi Ultra - Financial Document Model
 * 
 * Stores metadata, status, and checksum of uploaded/ingested financial documents
 * (SEC 10-K, 10-Q, 8-K filings, earnings releases, FOMC statements, and research PDFs).
 * 
 * @module models/Document
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const documentSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  filename: {
    type: String,
    required: true,
    trim: true,
  },
  fileType: {
    type: String,
    required: true,
    enum: ['pdf', 'txt', 'html', 'json', 'md', 'markdown'],
    default: 'pdf',
  },
  filePath: {
    type: String,
    default: null,
  },
  fileSize: {
    type: Number,
    default: 0,
  },
  sha256Hash: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  source: {
    type: String,
    required: true,
    enum: ['SEC_EDGAR', 'IR_PORTAL', 'FEDERAL_RESERVE', 'FINNHUB', 'MANUAL_UPLOAD', 'SYSTEM'],
    default: 'MANUAL_UPLOAD',
    index: true,
  },
  symbol: {
    type: String,
    uppercase: true,
    trim: true,
    default: 'GENERAL',
    index: true,
  },
  filingType: {
    type: String,
    uppercase: true,
    trim: true,
    default: 'REPORT', // '10-K', '10-Q', '8-K', 'FOMC', 'REPORT'
    index: true,
  },
  filingDate: {
    type: Date,
    default: Date.now,
    index: true,
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'processing', 'indexed', 'failed'],
    default: 'pending',
    index: true,
  },
  chunkCount: {
    type: Number,
    default: 0,
  },
  tokenCount: {
    type: Number,
    default: 0,
  },
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    default: null,
    index: true,
  },
  uploadedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  isPublic: {
    type: Boolean,
    default: true,
    index: true,
  },
  errorMessage: {
    type: String,
    default: null,
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

documentSchema.index({ symbol: 1, filingType: 1, filingDate: -1 });

export const Document = mongoose.model('Document', documentSchema);
export default Document;
