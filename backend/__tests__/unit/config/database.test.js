import { sanitizeMongoUri } from '../../../src/config/database.js';

describe('database config - sanitizeMongoUri', () => {
    it('should return empty/falsy input as is', () => {
        expect(sanitizeMongoUri('')).toBe('');
        expect(sanitizeMongoUri(null)).toBeNull();
        expect(sanitizeMongoUri(undefined)).toBeUndefined();
    });

    it('should return standard local connection URIs without modification', () => {
        const uri = 'mongodb://localhost:27017/global_fit_ulttra';
        expect(sanitizeMongoUri(uri)).toBe(uri);
    });

    it('should handle standard mongodb+srv URIs without special characters', () => {
        const uri = 'mongodb+srv://adminuser:password123@cluster0.mongodb.net/global_fit_ulttra?retryWrites=true&w=majority';
        expect(sanitizeMongoUri(uri)).toBe(uri);
    });

    it('should URL-encode raw special characters in password', () => {
        const inputUri = 'mongodb+srv://adminuser:p@ss#word123@cluster0.mongodb.net/global_fit_ulttra?retryWrites=true';
        const expectedUri = 'mongodb+srv://adminuser:p%40ss%23word123@cluster0.mongodb.net/global_fit_ulttra?retryWrites=true';
        expect(sanitizeMongoUri(inputUri)).toBe(expectedUri);
    });

    it('should preserve already URL-encoded passwords', () => {
        const inputUri = 'mongodb+srv://adminuser:p%40ss%23word123@cluster0.mongodb.net/global_fit_ulttra?retryWrites=true';
        expect(sanitizeMongoUri(inputUri)).toBe(inputUri);
    });

    it('should URL-encode special characters in username as well', () => {
        const inputUri = 'mongodb+srv://user@domain:secretpass@cluster0.mongodb.net/global_fit_ulttra';
        const expectedUri = 'mongodb+srv://user%40domain:secretpass@cluster0.mongodb.net/global_fit_ulttra';
        expect(sanitizeMongoUri(inputUri)).toBe(expectedUri);
    });
});
