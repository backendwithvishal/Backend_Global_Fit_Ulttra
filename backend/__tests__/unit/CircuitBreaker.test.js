/**
 * Global_Fit_Ulttra - Circuit Breaker Tests
 */

import { jest } from '@jest/globals';
import { CircuitBreaker, CircuitState } from '../../src/infrastructure/resilience/CircuitBreaker.js';
import { CircuitBreakerError } from '../../src/utils/errors.js';
import { StatusController } from '../../src/controllers/StatusController.js';

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

    describe('Test 1: Initial state', () => {
        it('should start in CLOSED state with zero counters and null timestamps', () => {
            expect(circuitBreaker.state).toBe(CircuitState.CLOSED);
            expect(circuitBreaker.failureCount).toBe(0);
            expect(circuitBreaker.successCount).toBe(0);
            expect(circuitBreaker.lastFailureTime).toBeNull();
            expect(circuitBreaker.nextAttemptTime).toBeNull();

            const status = circuitBreaker.getStatus();
            expect(status).toEqual({
                name: 'test-service',
                state: CircuitState.CLOSED,
                failureCount: 0,
                successCount: 0,
                failureThreshold: 3,
                resetTimeout: 1000,
                lastFailureTime: null,
                nextAttemptTime: null,
            });
        });
    });

    describe('Test 2: Successful request', () => {
        it('should execute successful function, increment successCount, and remain CLOSED', async () => {
            const result = await circuitBreaker.execute(() => Promise.resolve('ok'));
            expect(result).toBe('ok');
            expect(circuitBreaker.state).toBe(CircuitState.CLOSED);
            expect(circuitBreaker.successCount).toBe(1);
            expect(circuitBreaker.failureCount).toBe(0);

            // Execute another successful request
            await circuitBreaker.execute(() => Promise.resolve('ok2'));
            expect(circuitBreaker.successCount).toBe(2);
            expect(circuitBreaker.state).toBe(CircuitState.CLOSED);
        });
    });

    describe('Test 3: Failed request', () => {
        it('should increment failureCount, record lastFailureTime, and remain CLOSED until threshold', async () => {
            const startTime = Date.now();
            await expect(
                circuitBreaker.execute(() => Promise.reject(new Error('simulated network failure')))
            ).rejects.toThrow('simulated network failure');

            expect(circuitBreaker.state).toBe(CircuitState.CLOSED);
            expect(circuitBreaker.failureCount).toBe(1);
            expect(circuitBreaker.lastFailureTime).toBeGreaterThanOrEqual(startTime);
            expect(circuitBreaker.nextAttemptTime).toBeNull();

            // Success resets failure count in CLOSED state
            await circuitBreaker.execute(() => Promise.resolve('recovered'));
            expect(circuitBreaker.failureCount).toBe(0);
            expect(circuitBreaker.successCount).toBe(1);
        });
    });

    describe('Test 4: Failure threshold', () => {
        it('should open circuit after three consecutive failures and compute nextAttemptTime', async () => {
            const beforeFailures = Date.now();
            for (let i = 0; i < 3; i++) {
                try {
                    await circuitBreaker.execute(() => Promise.reject(new Error(`failure ${i + 1}`)));
                } catch (e) {
                    // Expected
                }
            }

            expect(circuitBreaker.state).toBe(CircuitState.OPEN);
            expect(circuitBreaker.failureCount).toBe(3);
            expect(circuitBreaker.nextAttemptTime).toBeGreaterThanOrEqual(beforeFailures + 1000);
            expect(circuitBreaker.isAllowingRequests()).toBe(false);
        });
    });

    describe('Test 5: Open circuit', () => {
        it('should reject requests without calling the provider when OPEN', async () => {
            // Trip the breaker
            for (let i = 0; i < 3; i++) {
                try {
                    await circuitBreaker.execute(() => Promise.reject(new Error('fail')));
                } catch (e) { }
            }
            expect(circuitBreaker.state).toBe(CircuitState.OPEN);

            const externalProviderMock = jest.fn().mockResolvedValue('should not be called');

            await expect(circuitBreaker.execute(externalProviderMock)).rejects.toThrow(CircuitBreakerError);
            expect(externalProviderMock).not.toHaveBeenCalled();
            expect(circuitBreaker.failureCount).toBe(3);
        });
    });

    describe('Test 6: Recovery (HALF_OPEN state)', () => {
        it('should enter HALF_OPEN after reset timeout and allow recovery request while rejecting concurrent ones', async () => {
            for (let i = 0; i < 3; i++) {
                try {
                    await circuitBreaker.execute(() => Promise.reject(new Error('fail')));
                } catch (e) { }
            }
            expect(circuitBreaker.state).toBe(CircuitState.OPEN);

            // Fast forward past reset timeout
            circuitBreaker.nextAttemptTime = Date.now() - 1;

            // Reading state reports HALF_OPEN without modifying state variables directly
            expect(circuitBreaker.state).toBe(CircuitState.HALF_OPEN);
            expect(circuitBreaker.getStatus().state).toBe(CircuitState.HALF_OPEN);
            expect(circuitBreaker.getStatus().nextAttemptTime).toBeNull();

            // Execute a slow probe request to test concurrency protection in HALF_OPEN
            let resolveProbe;
            const probePromise = new Promise((resolve) => { resolveProbe = resolve; });

            const probeExecution = circuitBreaker.execute(() => probePromise);

            // Concurrent request should be rejected while probe is in flight
            await expect(
                circuitBreaker.execute(() => Promise.resolve('concurrent attempt'))
            ).rejects.toThrow(CircuitBreakerError);

            // Complete the probe
            resolveProbe('probe successful');
            const result = await probeExecution;
            expect(result).toBe('probe successful');
        });
    });

    describe('Test 7: Successful recovery', () => {
        it('should transition to CLOSED and reset failure state after meeting success threshold', async () => {
            // Trip breaker
            for (let i = 0; i < 3; i++) {
                try {
                    await circuitBreaker.execute(() => Promise.reject(new Error('fail')));
                } catch (e) { }
            }
            expect(circuitBreaker.state).toBe(CircuitState.OPEN);

            // Advance past timeout
            circuitBreaker.nextAttemptTime = Date.now() - 1;

            // First recovery request
            await circuitBreaker.execute(() => Promise.resolve('ok 1'));
            expect(circuitBreaker.state).toBe(CircuitState.HALF_OPEN);
            expect(circuitBreaker.successCount).toBe(1);

            // Second recovery request (successThreshold is 2)
            await circuitBreaker.execute(() => Promise.resolve('ok 2'));
            expect(circuitBreaker.state).toBe(CircuitState.CLOSED);
            expect(circuitBreaker.failureCount).toBe(0);
            expect(circuitBreaker.nextAttemptTime).toBeNull();
        });
    });

    describe('Test 8: Failed recovery', () => {
        it('should transition back to OPEN and reschedule reset timeout if recovery request fails', async () => {
            // Trip breaker
            for (let i = 0; i < 3; i++) {
                try {
                    await circuitBreaker.execute(() => Promise.reject(new Error('fail')));
                } catch (e) { }
            }

            circuitBreaker.nextAttemptTime = Date.now() - 1;
            expect(circuitBreaker.state).toBe(CircuitState.HALF_OPEN);

            const beforeFailure = Date.now();
            await expect(
                circuitBreaker.execute(() => Promise.reject(new Error('recovery attempt failed')))
            ).rejects.toThrow('recovery attempt failed');

            expect(circuitBreaker.state).toBe(CircuitState.OPEN);
            expect(circuitBreaker.nextAttemptTime).toBeGreaterThanOrEqual(beforeFailure + 1000);
        });
    });

    describe('Test 9: Status endpoint', () => {
        it('should read live circuit breaker instances without mutating counters or state', async () => {
            const clientMock = {
                getCircuitBreakerStatus: () => circuitBreaker.getStatus(),
            };

            const controller = new StatusController({ apiClients: [clientMock] });

            const req = { requestId: 'test-request-id-1234' };
            let responseData = null;
            let responseStatus = null;
            const res = {
                status: (code) => {
                    responseStatus = code;
                    return {
                        json: (data) => {
                            responseData = data;
                        },
                    };
                },
            };

            controller.getCircuitBreakers(req, res);

            expect(responseStatus).toBe(200);
            expect(responseData.requestId).toBe('test-request-id-1234');
            expect(responseData.circuitBreakers).toHaveLength(1);
            expect(responseData.circuitBreakers[0]).toEqual({
                name: 'test-service',
                state: CircuitState.CLOSED,
                failureCount: 0,
                successCount: 0,
                failureThreshold: 3,
                resetTimeout: 1000,
                lastFailureTime: null,
                nextAttemptTime: null,
            });

            // Execute a request and verify the status endpoint sees the updated live counts
            await circuitBreaker.execute(() => Promise.resolve('ok'));

            controller.getCircuitBreakers(req, res);
            expect(responseData.circuitBreakers[0].successCount).toBe(1);
            expect(responseData.circuitBreakers[0].state).toBe(CircuitState.CLOSED);
        });
    });

    describe('Test 10: All six providers', () => {
        it('should verify all six providers independently and confirm isolation', async () => {
            const providerNames = [
                'alpha_vantage',
                'coingecko',
                'exchangerate_api',
                'newsapi',
                'fred',
                'finnhub',
            ];

            const breakers = providerNames.map(name => new CircuitBreaker(name, {
                failureThreshold: 3,
                resetTimeout: 1000,
            }));

            const clients = breakers.map(cb => ({
                getCircuitBreakerStatus: () => cb.getStatus(),
            }));

            const controller = new StatusController({ apiClients: clients });

            const req = { requestId: 'req-6-providers' };
            let responseData = null;
            const res = {
                status: () => ({
                    json: (data) => {
                        responseData = data;
                    },
                }),
            };

            controller.getCircuitBreakers(req, res);
            expect(responseData.circuitBreakers).toHaveLength(6);
            responseData.circuitBreakers.forEach((cbStatus, index) => {
                expect(cbStatus.name).toBe(providerNames[index]);
                expect(cbStatus.state).toBe(CircuitState.CLOSED);
                expect(cbStatus.failureCount).toBe(0);
                expect(cbStatus.successCount).toBe(0);
            });

            // Trip alpha_vantage only
            for (let i = 0; i < 3; i++) {
                try {
                    await breakers[0].execute(() => Promise.reject(new Error('alpha_vantage down')));
                } catch (e) { }
            }

            // Execute success on coingecko
            await breakers[1].execute(() => Promise.resolve('coingecko ok'));

            controller.getCircuitBreakers(req, res);
            const statuses = responseData.circuitBreakers;

            expect(statuses[0].name).toBe('alpha_vantage');
            expect(statuses[0].state).toBe(CircuitState.OPEN);
            expect(statuses[0].failureCount).toBe(3);

            expect(statuses[1].name).toBe('coingecko');
            expect(statuses[1].state).toBe(CircuitState.CLOSED);
            expect(statuses[1].successCount).toBe(1);

            // Other 4 providers must remain completely unaffected (CLOSED, 0 failures, 0 successes)
            for (let i = 2; i < 6; i++) {
                expect(statuses[i].state).toBe(CircuitState.CLOSED);
                expect(statuses[i].failureCount).toBe(0);
                expect(statuses[i].successCount).toBe(0);
            }
        });
    });

    describe('Manual reset()', () => {
        it('should reset to clean CLOSED state', async () => {
            for (let i = 0; i < 3; i++) {
                try {
                    await circuitBreaker.execute(() => Promise.reject(new Error('fail')));
                } catch (e) { }
            }

            expect(circuitBreaker.state).toBe(CircuitState.OPEN);
            circuitBreaker.reset();

            expect(circuitBreaker.state).toBe(CircuitState.CLOSED);
            expect(circuitBreaker.failureCount).toBe(0);
            expect(circuitBreaker.successCount).toBe(0);
            expect(circuitBreaker.lastFailureTime).toBeNull();
            expect(circuitBreaker.nextAttemptTime).toBeNull();
        });
    });
});
