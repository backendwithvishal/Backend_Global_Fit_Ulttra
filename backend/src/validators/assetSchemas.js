// Financial asset validation schemas

import { z } from 'zod';

export const createAssetSchema = z.object({
    body: z.object({
        symbol: z.string()
            .min(1, 'Symbol is required')
            .toUpperCase()
            .trim(),
        name: z.string()
            .min(1, 'Asset name is required')
            .trim(),
        type: z.enum(['stock', 'crypto', 'forex', 'commodity', 'index'], {
            errorMap: () => ({ message: 'Type must be stock, crypto, forex, commodity, or index' }),
        }),
        currentPrice: z.number()
            .positive('Price must be positive')
            .finite('Price must be a valid number')
            .optional(),
        currency: z.string()
            .length(3, 'Currency must be a 3-letter code')
            .toUpperCase()
            .optional(),
        metadata: z.object({
            exchange: z.string().optional(),
            sector: z.string().optional(),
            industry: z.string().optional(),
            marketCap: z.number().optional(),
            description: z.string().optional(),
            website: z.string().url().optional(),
            logo: z.string().url().optional(),
        }).optional(),
    }),
});

export const updateAssetSchema = z.object({
    params: z.object({
        symbol: z.string().toUpperCase().trim(),
    }),
    body: z.object({
        name: z.string()
            .min(1, 'Asset name is required')
            .trim()
            .optional(),
        type: z.enum(['stock', 'crypto', 'forex', 'commodity', 'index']).optional(),
        currentPrice: z.number()
            .positive('Price must be positive')
            .finite('Price must be a valid number')
            .optional(),
        currency: z.string()
            .length(3, 'Currency must be a 3-letter code')
            .toUpperCase()
            .optional(),
        isActive: z.boolean().optional(),
        metadata: z.object({
            exchange: z.string().optional(),
            sector: z.string().optional(),
            industry: z.string().optional(),
            marketCap: z.number().optional(),
            description: z.string().optional(),
            website: z.string().url().optional(),
            logo: z.string().url().optional(),
        }).optional(),
    }),
});

export const getAssetSchema = z.object({
    params: z.object({
        symbol: z.string().toUpperCase().trim(),
    }),
});

export const deleteAssetSchema = getAssetSchema;

export const searchAssetsSchema = z.object({
    query: z.object({
        type: z.enum(['stock', 'crypto', 'forex', 'commodity', 'index']).optional(),
        search: z.string().max(100, 'Search query too long').optional(),
        isActive: z.enum(['true', 'false']).transform(val => val === 'true').optional(),
        page: z.string().regex(/^\d+$/).transform(Number).optional(),
        limit: z.string().regex(/^\d+$/).transform(Number).optional(),
        sort: z.string().optional(),
    }),
});

export const getLiveAssetSchema = z.object({
    params: z.object({
        symbol: z.string().toUpperCase().trim(),
    }),
    query: z.object({
        forceRefresh: z.enum(['true', 'false']).transform(val => val === 'true').optional(),
    }),
});

export default {
    createAssetSchema,
    updateAssetSchema,
    getAssetSchema,
    deleteAssetSchema,
    searchAssetsSchema,
    getLiveAssetSchema,
};
