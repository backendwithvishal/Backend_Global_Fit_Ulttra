/**
 * Global_Fit_Ulttra - Job Model
 *
 * Tracks asynchronous background jobs (RAG ingestion, reindexing, batch AI analysis).
 *
 * @module models/Job
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const jobSchema = new Schema({
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['ingest', 'reindex', 'sentiment', 'analysis', 'batch'],
    index: true,
  },
  status: {
    type: String,
    required: true,
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
    index: true,
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  data: {
    type: Schema.Types.Mixed,
    default: {},
  },
  result: {
    type: Schema.Types.Mixed,
    default: null,
  },
  error: {
    type: String,
    default: null,
  },
  startedAt: {
    type: Date,
    default: null,
  },
  completedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

export const Job = mongoose.model('Job', jobSchema);
export default Job;

