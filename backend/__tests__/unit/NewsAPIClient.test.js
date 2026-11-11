/**
 * Global_Fit_Ulttra - NewsAPI Client & Circuit Breaker Tests
 */

import { jest } from '@jest/globals';
import { NewsAPIClient } from '../../src/infrastructure/http/NewsAPIClient.js';
import { CircuitState } from '../../src/infrastructure/resilience/CircuitBreaker.js';
import { CircuitBreakerError } from '../../src/utils/errors.js';

describe('NewsAPIClient Circuit Breaker Integration', () => {
    let client;

    beforeEach(() => {
        client = new NewsAPIClient({
            baseURL: 'https://newsapi.org',
            apiKey: 'mock-news-api-key',
        });
    });

    it('should configure correct baseURL without redundant /api prefix', () => {
        expect(client.baseURL).toBe('https://newsapi.org');
        expect(client.circuitBreaker.name).toBe('newsapi');
        expect(client.circuitBreaker.state).toBe(CircuitState.CLOSED);
        expect(client.circuitBreaker.failureCount).toBe(0);
        expect(client.circuitBreaker.successCount).toBe(0);
    });

    it('should increment successCount on successful request through circuit breaker', async () => {
        const mockArticles = [
            {
                title: 'Market Rally Continues',
                description: 'Global stocks surge today',
                url: 'https://example.com/article1',
                urlToImage: 'https://example.com/img1.jpg',
                publishedAt: '2026-11-11T10:00:00Z',
                author: 'Finance Reporter',
                source: { name: 'Reuters' },
            },
        ];

        // Mock client.client.get to return successful response
        jest.spyOn(client.client, 'get').mockResolvedValueOnce({
            data: {
                status: 'ok',
                totalResults: 1,
                articles: mockArticles,
            },
        });

        const result = await client.getEverything({ q: 'economy' });
        expect(result.articles).toHaveLength(1);
        expect(result.source).toBe('newsapi');
        expect(client.circuitBreaker.successCount).toBe(1);
        expect(client.circuitBreaker.failureCount).toBe(0);
        expect(client.circuitBreaker.state).toBe(CircuitState.CLOSED);
    });

    it('should increment failureCount and record lastFailureTime on failed request', async () => {
        // Mock 404 or 401 client error
        const httpError = new Error('Request failed with status code 404');
        httpError.response = { status: 404, data: 'Not Found' };
        jest.spyOn(client.client, 'get').mockRejectedValueOnce(httpError);

        const beforeFailure = Date.now();
        await expect(client.getEverything()).rejects.toThrow();

        expect(client.circuitBreaker.failureCount).toBe(1);
        expect(client.circuitBreaker.lastFailureTime).toBeGreaterThanOrEqual(beforeFailure);
        expect(client.circuitBreaker.state).toBe(CircuitState.CLOSED);
    });

    it('should trip circuit breaker to OPEN after threshold failures', async () => {
        const httpError = new Error('Request failed with status code 404');
        httpError.response = { status: 404 };
        jest.spyOn(client.client, 'get').mockRejectedValue(httpError);

        // Simulate 3 failures
        for (let i = 0; i < 3; i++) {
            try {
                await client.getEverything();
            } catch (e) {
                // Expected
            }
        }

        expect(client.circuitBreaker.state).toBe(CircuitState.OPEN);
        expect(client.circuitBreaker.failureCount).toBe(3);
        expect(client.circuitBreaker.nextAttemptTime).toBeGreaterThan(Date.now());

        // Subsequent call while OPEN should fail fast without invoking HTTP client
        const getSpy = jest.spyOn(client.client, 'get');
        getSpy.mockClear();

        await expect(client.getEverything()).rejects.toThrow(CircuitBreakerError);
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('should recover from OPEN to HALF_OPEN to CLOSED upon successful trial', async () => {
        const httpError = new Error('HTTP 500');
        httpError.response = { status: 500 };
        jest.spyOn(client.client, 'get').mockRejectedValue(httpError);

        // Trip the breaker
        for (let i = 0; i < 3; i++) {
            try {
                await client.getEverything();
            } catch (e) { }
        }
        expect(client.circuitBreaker.state).toBe(CircuitState.OPEN);

        // Fast forward past reset timeout
        client.circuitBreaker.nextAttemptTime = Date.now() - 1;
        expect(client.circuitBreaker.state).toBe(CircuitState.HALF_OPEN);

        // Mock recovery successes
        jest.spyOn(client.client, 'get').mockResolvedValue({
            data: {
                status: 'ok',
                articles: [],
                totalResults: 0,
            },
        });

        // First recovery attempt
        await client.getEverything();
        expect(client.circuitBreaker.state).toBe(CircuitState.HALF_OPEN);

        // Second recovery attempt (default successThreshold is 2)
        await client.getEverything();
        expect(client.circuitBreaker.state).toBe(CircuitState.CLOSED);
        expect(client.circuitBreaker.failureCount).toBe(0);
    });
});
