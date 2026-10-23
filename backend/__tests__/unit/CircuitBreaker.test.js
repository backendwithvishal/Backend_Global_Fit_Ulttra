/**
 * Global_Fit_Ulttra - Circuit Breaker Tests
 */

import { jest } from '@jest/globals';
import { CircuitBreaker, CircuitState } from '../../src/infrastructure/resilience/CircuitBreaker.js';

// Mock logger
jest.unstable_mockModule('../../src/config/logger.js', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

// Mock config
jest.unstable_mockModule('../../src/config/environment.js', () => ({
    config: {
        circuitBreaker: {
            threshold: 3,
            resetTimeout: 1000,
        },
    },
}));

describe('CircuitBreaker', () => {
    let circuitBreaker;

    beforeEach(() => {
        circuitBreaker = new CircuitBreaker('test-service', {
            failureThreshold: 3,
            resetTimeout: 1000,
            successThreshold: 2,
        });
    });

    describe('Initial State', () => {
        it('should start in CLOSED state', () => {
            expect(circuitBreaker.state).toBe(CircuitState.CLOSED);
        });

        it('should have zero failure count', () => {
            expect(circuitBreaker.failureCount).toBe(0);
        });
    });

    describe('execute()', () => {
        it('should execute successful function', async () => {
            const result = await circuitBreaker.execute(() => Promise.resolve('success'));
            expect(result).toBe('success');
        });

        it('should throw error from failed function', async () => {
            await expect(
                circuitBreaker.execute(() => Promise.reject(new Error('test error')))
            ).rejects.toThrow('test error');
        });

        it('should increment failure count on failure', async () => {
            try {
                await circuitBreaker.execute(() => Promise.reject(new Error('fail')));
            } catch (e) {
                // Expected
            }
            expect(circuitBreaker.failureCount).toBe(1);
        });

        it('should open circuit after threshold failures', async () => {
            for (let i = 0; i < 3; i++) {
                try {
                    await circuitBreaker.execute(() => Promise.reject(new Error('fail')));
                } catch (e) {
                    // Expected
                }
            }
            expect(circuitBreaker.state).toBe(CircuitState.OPEN);
        });
    });

    describe('State Transitions', () => {
        it('should transition to HALF_OPEN after reset timeout', async () => {
            // Trip the breaker
            for (let i = 0; i < 3; i++) {
                try {
                    await circuitBreaker.execute(() => Promise.reject(new Error('fail')));
                } catch (e) { }
            }
            expect(circuitBreaker.state).toBe(CircuitState.OPEN);

            // Fast forward past reset timeout
            circuitBreaker.nextAttemptTime = Date.now() - 1;

            // Next request should transition to HALF_OPEN
            await circuitBreaker.execute(() => Promise.resolve('success'));
            expect(circuitBreaker.state).toBe(CircuitState.HALF_OPEN);
        });

        it('should close circuit after success threshold in HALF_OPEN', async () => {
            circuitBreaker.state = CircuitState.HALF_OPEN;
            circuitBreaker.successCount = 0;

            await circuitBreaker.execute(() => Promise.resolve('success'));
            await circuitBreaker.execute(() => Promise.resolve('success'));

            expect(circuitBreaker.state).toBe(CircuitState.CLOSED);
        });
    });

    describe('getStatus()', () => {
        it('should return correct status object', () => {
            const status = circuitBreaker.getStatus();

            expect(status).toMatchObject({
                name: 'test-service',
                state: CircuitState.CLOSED,
                failureCount: 0,
                failureThreshold: 3,
            });
        });
    });

    describe('reset()', () => {
        it('should reset to CLOSED state', async () => {
            // Trip the breaker
            for (let i = 0; i < 3; i++) {
                try {
                    await circuitBreaker.execute(() => Promise.reject(new Error('fail')));
                } catch (e) { }
            }

            circuitBreaker.reset();

            expect(circuitBreaker.state).toBe(CircuitState.CLOSED);
            expect(circuitBreaker.failureCount).toBe(0);
        });
    });
});
