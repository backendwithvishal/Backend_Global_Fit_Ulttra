/**
 * Global_Fit_Ulttra - RAG Request Validators
 * 
 * Zod validation schemas for RAG query and ingestion endpoints.
 * Structured to match validateRequest middleware (body / query / params).
 * 
 * @module validators/ragSchemas
 */

import { z } from 'zod';

export const ragQuerySchema = z.object({
  body: z.object({
    question: z.string()
      .min(2, 'Question must be at least 2 characters')
      .max(1000, 'Question cannot exceed 1000 characters'),
    symbol: z.string().max(10).optional().transform(v => v ? v.toUpperCase().trim() : undefined),
    filingType: z.enum(['10-K', '10-Q', '8-K', 'FOMC', 'REPORT', 'ALL']).optional(),
    topK: z.number().int().min(1).max(10).default(4).optional(),
    bypassCache: z.boolean().default(false).optional(),
  }),
});

export const ragIngestSchema = z.object({
  body: z.object({
    filePath: z.string().optional(),
    title: z.string().max(200).optional(),
    symbol: z.string().max(10).optional().transform(v => v ? v.toUpperCase().trim() : undefined),
    filingType: z.enum(['10-K', '10-Q', '8-K', 'FOMC', 'REPORT']).optional(),
    source: z.enum(['SEC_EDGAR', 'IR_PORTAL', 'FEDERAL_RESERVE', 'FINNHUB', 'MANUAL_UPLOAD', 'SYSTEM']).optional(),
    isPublic: z.boolean().default(true).optional(),
  }).optional().default({}),
});

export const ragDocumentListSchema = z.object({
  query: z.object({
    symbol: z.string().max(10).optional(),
    filingType: z.string().optional(),
    status: z.enum(['pending', 'processing', 'indexed', 'failed']).optional(),
    page: z.string().transform(Number).pipe(z.number().int().min(1)).default('1').optional(),
    limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).default('20').optional(),
  }).optional(),
});

export default {
  ragQuerySchema,
  ragIngestSchema,
  ragDocumentListSchema,
};
