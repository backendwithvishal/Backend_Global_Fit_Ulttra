/**
 * Global_Fit_Ulttra - Money Value Object Tests
 */

import { Money } from '../../src/utils/valueObjects.js';

describe('Money', () => {
    describe('constructor', () => {
        it('should create Money from string', () => {
            const money = new Money('123.45');
            expect(money.toString()).toBe('123.45');
        });

        it('should create Money from number', () => {
            const money = new Money(123.45);
            expect(money.toString()).toBe('123.45');
        });

        it('should throw on invalid value', () => {
            expect(() => new Money('invalid')).toThrow('Invalid monetary value');
        });
    });

    describe('static methods', () => {
        it('should create with of()', () => {
            const money = Money.of('100');
            expect(money.toString()).toBe('100');
        });

        it('should create zero with zero()', () => {
            const money = Money.zero();
            expect(money.toString()).toBe('0');
        });
    });

    describe('arithmetic operations', () => {
        it('should add Money values', () => {
            const a = new Money('100.50');
            const b = new Money('50.25');
            expect(a.plus(b).toString()).toBe('150.75');
        });

        it('should subtract Money values', () => {
            const a = new Money('100.50');
            const b = new Money('50.25');
            expect(a.minus(b).toString()).toBe('50.25');
        });

        it('should multiply Money values', () => {
            const price = new Money('10.00');
            const result = price.times(3);
            expect(result.toString()).toBe('30');
        });

        it('should divide Money values', () => {
            const total = new Money('100.00');
            const result = total.div(4);
            expect(result.toString()).toBe('25');
        });

        it('should handle precision correctly', () => {
            // This would fail with regular JS numbers
            const a = new Money('0.1');
            const b = new Money('0.2');
            expect(a.plus(b).toString()).toBe('0.3');
        });
    });

    describe('comparison operations', () => {
        it('should compare with gt()', () => {
            const a = new Money('100');
            const b = new Money('50');
            expect(a.gt(b)).toBe(true);
            expect(b.gt(a)).toBe(false);
        });

        it('should compare with lt()', () => {
            const a = new Money('50');
            const b = new Money('100');
            expect(a.lt(b)).toBe(true);
        });

        it('should compare with eq()', () => {
            const a = new Money('100.00');
            const b = new Money('100');
            expect(a.eq(b)).toBe(true);
        });
    });

    describe('formatting', () => {
        it('should format to fixed decimal places', () => {
            const money = new Money('123.456789');
            expect(money.toFixed(2)).toBe('123.46');
        });

        it('should round correctly', () => {
            const money = new Money('123.456');
            expect(money.round(2).toString()).toBe('123.46');
        });
    });
});
