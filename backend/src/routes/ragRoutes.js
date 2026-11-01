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
import { requireAuth, checkRole } from '../middleware/authMiddleware.js';
import { uploadPdf, validatePdfMagicBytes } from '../middleware/uploadMiddleware.js';
import {
  ragQuerySchema,
  ragIngestSchema,
  ragDocumentListSchema,
} from '../validators/ragSchemas.js';

export const createRAGRoutes = (ragController) => {
  const router = Router();

  // All RAG routes require authentication
  router.use(requireAuth);

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

  // Grounded RAG Query (Authenticated members)
  router.post('/query', validateRequest(ragQuerySchema), ragController.query);

  // Trigger ingestion of documents (Admin only, file upload or default directory)
  router.post(
    '/ingest',
    checkRole(['Admin']),
    uploadPdf.single('file'),
    validatePdfMagicBytes,
    validateRequest(ragIngestSchema),
    ragController.ingest
  );

  // Re-index all documents in the repository (Admin only)
  if (typeof ragController.reindex === 'function') {
    router.post('/reindex', checkRole(['Admin']), ragController.reindex);
  }

  // Ingestion job status
  if (typeof ragController.getJob === 'function') {
    router.get('/jobs/:jobId', ragController.getJob);
  }

  // Trigger RAG evaluation benchmark (Admin only)
  if (typeof ragController.evaluate === 'function') {
    router.post('/evaluate', checkRole(['Admin']), ragController.evaluate);
  }

  // List indexed documents
  router.get('/documents', validateRequest(ragDocumentListSchema), ragController.listDocuments);

  // Get specific document by ID
  router.get('/documents/:id', ragController.getDocument);

  // Delete document (Admin only)
  router.delete('/documents/:id', checkRole(['Admin']), ragController.deleteDocument);

  // Vector index statistics
  router.get('/stats', ragController.getStats);

  return router;
};

export default createRAGRoutes;
