/**
 * Global_Fit_Ulttra - Evaluation Dataset Schema
 * 
 * Zod validation schema for the Financial RAG Evaluation Dataset.
 * Ensures consistent data types, required fields, and clear provenance.
 * 
 * @module evaluation/dataset/datasetSchema
 */

import { z } from 'zod';

export const evaluationSampleSchema = z.object({
  id: z.string().min(1, 'Sample ID is required'),
  question: z.string().min(3, 'Question must be at least 3 characters'),
  symbol: z.string().optional().nullable(),
  filing_type: z.string().optional().nullable(),
  reference_answer: z.string().optional().nullable(),
  reference_contexts: z.array(z.string()).optional(),
  reference_context_ids: z.array(z.string()).optional(),
  reference_entities: z.array(z.union([z.string(), z.object({ name: z.string(), value: z.string() })])).optional(),
  expected_citations: z.array(z.string()).optional(),
  expected_financial_values: z.array(z.union([z.string(), z.number()])).optional(),
  expected_reporting_period: z.string().optional().nullable(),
  expected_currency: z.string().optional().nullable(),
  expected_behavior: z.enum(['ANSWER', 'REFUSE', 'LIVE_MARKET', 'SECURITY_ISOLATION']).default('ANSWER'),
  expected_intent: z.enum(['DOCUMENT_QA', 'LIVE_MARKET', 'COMPARISON', 'RISK_ANALYSIS']).optional(),
  expected_tools: z.array(z.string()).optional(),
  relevance_scores: z.record(z.number()).optional(),
  tags: z.array(z.string()).default([]),
  provenance: z.object({
    sourceDocument: z.string(),
    verifiedBy: z.string(),
    verificationStatus: z.enum(['VERIFIED_AUTHENTIC', 'PROVISIONAL', 'SYNTHETIC_CONTROL']),
    notes: z.string().optional(),
  }),
});

export const evaluationDatasetSchema = z.object({
  datasetVersion: z.string(),
  name: z.string(),
  description: z.string(),
  updatedAt: z.string(),
  samples: z.array(evaluationSampleSchema).min(1, 'Dataset must contain at least 1 sample'),
});

export function validateEvaluationDataset(data) {
  return evaluationDatasetSchema.safeParse(data);
}
