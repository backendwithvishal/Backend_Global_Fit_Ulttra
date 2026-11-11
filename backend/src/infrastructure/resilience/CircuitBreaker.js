// Circuit breaker - CLOSED → OPEN → HALF_OPEN state machine
// Prevents cascading failures from external API issues

import { logger } from '../../config/logger.js';
import { config } from '../../config/environment.js';
import { CircuitBreakerError } from '../../utils/errors.js';

export const CircuitState = {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN',
};

export class CircuitBreaker {
    constructor(name, options = {}) {
        this.name = name;
        this.failureThreshold = options.failureThreshold || config.circuitBreaker.threshold;
        this.resetTimeout = options.resetTimeout || config.circuitBreaker.resetTimeout;
        this.successThreshold = options.successThreshold !== undefined ? options.successThreshold : 2;
        this.onStateChange = options.onStateChange || null;

        // State
        this._state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.nextAttemptTime = null;
        this._halfOpenCallInProgress = false;
    }

    get state() {
        if (this._state === CircuitState.OPEN && this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
            return CircuitState.HALF_OPEN;
        }
        return this._state;
    }

    set state(newState) {
        this._state = newState;
    }

    // Execute function through circuit breaker
    async execute(fn) {
        if (this._state === CircuitState.OPEN) {
            if (Date.now() < this.nextAttemptTime) {
                throw new CircuitBreakerError(this.name);
            }
            this._setState(CircuitState.HALF_OPEN);
        }

        if (this.state === CircuitState.HALF_OPEN) {
            if (this._halfOpenCallInProgress) {
                throw new CircuitBreakerError(this.name);
            }
            this._halfOpenCallInProgress = true;
        }

        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (error) {
            this._onFailure();
            throw error;
        } finally {
            if (this._state === CircuitState.HALF_OPEN) {
                this._halfOpenCallInProgress = false;
            }
        }
    }

    // Handle successful execution
    _onSuccess() {
        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= this.successThreshold) {
                this._setState(CircuitState.CLOSED);
            }
        } else if (this.state === CircuitState.CLOSED) {
            this.successCount++;
            this.failureCount = 0;
        }
    }

    // Handle failed execution
    _onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.state === CircuitState.HALF_OPEN) {
            this._setState(CircuitState.OPEN);
        } else if (this.failureCount >= this.failureThreshold) {
            this._setState(CircuitState.OPEN);
        }

        logger.warn(`Circuit breaker ${this.name}: failure ${this.failureCount}/${this.failureThreshold}`, {
            service: this.name,
            state: this.state,
            failureCount: this.failureCount,
        });
    }

    // Set circuit breaker state
    _setState(newState) {
        const oldState = this._state;
        if (oldState === newState) {
            return;
        }

        this._state = newState;

        if (newState === CircuitState.OPEN) {
            this.nextAttemptTime = Date.now() + this.resetTimeout;
            this.successCount = 0;
            this._halfOpenCallInProgress = false;
        } else if (newState === CircuitState.CLOSED) {
            this.failureCount = 0;
            this.successCount = 0;
            this.nextAttemptTime = null;
            this._halfOpenCallInProgress = false;
        } else if (newState === CircuitState.HALF_OPEN) {
            this.successCount = 0;
            this.nextAttemptTime = null;
            this._halfOpenCallInProgress = false;
        }

        logger.info(`Circuit breaker ${this.name}: ${oldState} → ${newState}`, {
            service: this.name,
            oldState,
            newState,
        });

        if (this.onStateChange) {
            this.onStateChange({
                service: this.name,
                oldState,
                newState,
                timestamp: new Date().toISOString(),
            });
        }
    }

    // Get current status
    getStatus() {
        const currentState = this.state;
        return {
            name: this.name,
            state: currentState,
            failureCount: this.failureCount,
            successCount: this.successCount,
            failureThreshold: this.failureThreshold,
            resetTimeout: this.resetTimeout,
            lastFailureTime: this.lastFailureTime,
            nextAttemptTime: currentState === CircuitState.OPEN ? this.nextAttemptTime : null,
        };
    }

    // Manually reset to closed state
    reset() {
        const oldState = this._state;
        this._state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.nextAttemptTime = null;
        this._halfOpenCallInProgress = false;

        if (oldState !== CircuitState.CLOSED) {
            logger.info(`Circuit breaker ${this.name}: ${oldState} → CLOSED (manual reset)`);
            if (this.onStateChange) {
                this.onStateChange({
                    service: this.name,
                    oldState,
                    newState: CircuitState.CLOSED,
                    timestamp: new Date().toISOString(),
                });
            }
        }
        logger.info(`Circuit breaker ${this.name}: manually reset`);
    }

    // Check if allowing requests
    isAllowingRequests() {
        if (this.state === CircuitState.CLOSED) return true;
        if (this.state === CircuitState.HALF_OPEN) return !this._halfOpenCallInProgress;
        if (this.state === CircuitState.OPEN && this.nextAttemptTime && Date.now() >= this.nextAttemptTime) return true;
        return false;
    }
}

export default CircuitBreaker;
