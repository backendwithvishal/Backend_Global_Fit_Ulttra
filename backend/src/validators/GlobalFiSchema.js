// Global_Fit_Ulttra output schema for normalized Socket.io broadcasts

import { z } from 'zod';

// Stock data
export const stockDataSchema = z.object({
    symbol: z.string(),
    price: z.string(),
    change: z.string(),
    changePercent: z.string(),
    open: z.string().nullable().optional(),
    high: z.string().nullable().optional(),
    low: z.string().nullable().optional(),
    volume: z.string().nullable().optional(),
    latestTradingDay: z.string().nullable().optional(),
    previousClose: z.string().nullable().optional(),
    source: z.literal('alpha_vantage'),
});

// Crypto data
export const cryptoDataSchema = z.object({
    symbol: z.string(),
    priceUSD: z.string(),
    change24h: z.string().nullable().optional(),
    allCoins: z.array(z.object({
        id: z.string(),
        symbol: z.string(),
        currency: z.string(),
        price: z.string(),
        change24h: z.string().nullable(),
        marketCap: z.string().nullable(),
    })).optional(),
    source: z.literal('coingecko'),
});

// Forex data
export const forexDataSchema = z.object({
    baseCurrency: z.string(),
    rates: z.record(z.string()),
    allRates: z.record(z.string()).optional(),
    date: z.string().optional(),
    provider: z.string().optional(),
    source: z.literal('exchangerate_api'),
});

// News article
export const newsArticleSchema = z.object({
    title: z.string(),
    description: z.string(),
    url: z.string(),
    urlToImage: z.string().nullable().optional(),
    publishedAt: z.string().nullable(),
    author: z.string().nullable().optional(),
    sourceName: z.string(),
});

// Economic data
export const economicDataSchema = z.object({
    indicator: z.string(),
    value: z.string().nullable(),
    date: z.string().nullable(),
    realtimeStart: z.string().nullable().optional(),
    realtimeEnd: z.string().nullable().optional(),
    source: z.literal('fred'),
});

// Market news
export const marketNewsSchema = z.object({
    id: z.string().nullable(),
    headline: z.string(),
    summary: z.string(),
    url: z.string(),
    image: z.string().nullable(),
    datetime: z.string().nullable(),
    category: z.string(),
    related: z.string().nullable().optional(),
    sourceName: z.string(),
});

// Error entry
export const errorEntrySchema = z.object({
    service: z.string(),
    code: z.string(),
    message: z.string(),
});

// Metadata
export const metadataSchema = z.object({
    totalDuration: z.number(),
    cacheHits: z.number(),
    apiCallsMade: z.number(),
});

// Complete Global-Fi schema
export const globalFiSchema = z.object({
    requestId: z.string().uuid(),
    timestamp: z.string().datetime(),
    status: z.enum(['success', 'partial', 'error']),
    data: z.object({
        stocks: stockDataSchema.nullable().optional(),
        crypto: cryptoDataSchema.nullable().optional(),
        forex: forexDataSchema.nullable().optional(),
        news: z.array(newsArticleSchema).optional(),
        economic: economicDataSchema.nullable().optional(),
        marketNews: z.array(marketNewsSchema).optional(),
    }),
    errors: z.array(errorEntrySchema),
    metadata: metadataSchema,
});

export const globalFitUlttraSchema = globalFiSchema;
export default globalFitUlttraSchema;
