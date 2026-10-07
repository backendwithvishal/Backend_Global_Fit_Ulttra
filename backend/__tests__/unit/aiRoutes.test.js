/**
 * AI Routes Unit Tests
 * 
 * @jest-environment node
 */

import express from 'express';
import request from 'supertest';
import { createAIRoutes } from '../../src/routes/aiRoutes.js';

describe('aiRoutes', () => {
    describe('Disabled AI service (no aiController)', () => {
        let app;

        beforeEach(() => {
            app = express();
            app.use(express.json());
            app.use('/api/v1/ai', createAIRoutes(null));
        });

        it('should return 503 and E5003 error when AI is disabled', async () => {
            const res = await request(app)
                .post('/api/v1/ai/sentiment')
                .send({ text: 'Bitcoin rallies 10 percent' });

            expect(res.status).toBe(503);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toEqual({
                code: 'E5003',
                message: 'AI services are currently disabled. Please configure GROQ_API_KEY to enable them.'
            });
        });
    });

    describe('Enabled AI service (with aiController)', () => {
        let app;
        let mockAIController;

        beforeEach(() => {
            mockAIController = {
                analyzeSentiment: (req, res) => res.json({
                    success: true,
                    data: { sentiment: 'positive', confidence: 90, reasoning: 'Strong rally' }
                }),
                analyzeAsset: (req, res) => res.json({ success: true, data: {} }),
                compareAssets: (req, res) => res.json({ success: true, data: {} }),
                generateRecommendation: (req, res) => res.json({ success: true, data: {} }),
                analyzePortfolio: (req, res) => res.json({ success: true, data: {} }),
                predictPrice: (req, res) => res.json({ success: true, data: {} }),
                explainMovement: (req, res) => res.json({ success: true, data: {} }),
                analyzeNewsImpact: (req, res) => res.json({ success: true, data: {} }),
                generateNewsSummary: (req, res) => res.json({ success: true, data: {} }),
                submitJob: (req, res) => res.json({ success: true, data: {} }),
                getQueueStats: (req, res) => res.json({ success: true, data: {} }),
            };

            app = express();
            app.use(express.json());
            app.use('/api/v1/ai', createAIRoutes(mockAIController));
        });

        it('should route sentiment requests to aiController when enabled', async () => {
            const res = await request(app)
                .post('/api/v1/ai/sentiment')
                .send({ text: 'Bitcoin rallies 10 percent' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.sentiment).toBe('positive');
        });

        it('should return AI service discovery info on GET /', async () => {
            const res = await request(app)
                .get('/api/v1/ai');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.service).toBe('Global-Fi Ultra AI Service');
        });

        it('should return 400 validation error if text is missing', async () => {
            const res = await request(app)
                .post('/api/v1/ai/sentiment')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('E1008');
        });
    });
});
