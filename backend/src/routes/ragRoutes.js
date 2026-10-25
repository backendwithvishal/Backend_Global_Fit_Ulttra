/**
 * Global_Fit_Ulttra - RAG Routes
 * 
 * Express routes for financial Retrieval-Augmented Generation:
 * - /query: Grounded financial Q&A with exact filing citations
 * - /ingest: Trigger document ingestion pipeline
 * - /documents: List indexed filings and status
 * - /documents/:id: View document chunks and vector metadata
 * - /stats: Coverage and vector store statistics
 * 
 * @module routes/ragRoutes
 */

import { Router } from 'express';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  ragQuerySchema,
  ragIngestSchema,
  ragDocumentListSchema,
} from '../validators/ragSchemas.js';

export const createRAGRoutes = (ragController) => {
  const router = Router();

  if (!ragController) {
    router.use((req, res) => {
      res.status(503).json({
        success: false,
        error: {
          code: 'E5003',
          message: 'RAG service is currently disabled or initializing.',
        },
        requestId: req.requestId,
      });
    });
    return router;
  }

  // RAG Subsystem Health Check
  if (typeof ragController.getHealth === 'function') {
    router.get('/health', ragController.getHealth);
  }

  // Grounded RAG Query
  router.post('/query', validateRequest(ragQuerySchema), ragController.query);

  // Trigger ingestion of documents
  router.post('/ingest', validateRequest(ragIngestSchema), ragController.ingest);

  // Re-index all documents in the repository
  if (typeof ragController.reindex === 'function') {
    router.post('/reindex', ragController.reindex);
  }

  // Ingestion job status
  if (typeof ragController.getJob === 'function') {
    router.get('/jobs/:jobId', ragController.getJob);
  }

  // Trigger RAG evaluation benchmark
  if (typeof ragController.evaluate === 'function') {
    router.post('/evaluate', ragController.evaluate);
  }

  // List indexed documents
  router.get('/documents', validateRequest(ragDocumentListSchema), ragController.listDocuments);

  // Get specific document by ID
  router.get('/documents/:id', ragController.getDocument);

  // Delete document
  router.delete('/documents/:id', ragController.deleteDocument);

  // Vector index statistics
  router.get('/stats', ragController.getStats);

  return router;
};

export default createRAGRoutes;
