// NewsAPI client for financial news (free tier: 100 requests/day)

import { BaseApiClient } from './BaseApiClient.js';
import { config } from '../../config/environment.js';
import { ValidationError } from '../../utils/errors.js';

export class NewsAPIClient extends BaseApiClient {
    constructor(options = {}) {
        super('newsapi', {
            baseURL: options.baseURL || 'https://newsapi.org',
            timeout: options.timeout || 15000,
            headers: {
                'X-Api-Key': options.apiKey || config.apiKeys.newsApi,
                'User-Agent': 'GlobalFitUltra/1.0',
            },
            onCircuitStateChange: options.onCircuitStateChange,
        });
    }

    async getEverything(params = {}) {
        const {
            q = 'finance OR stock market',
            language = 'en',
            sortBy = 'publishedAt',
            pageSize = 10,
        } = params;

        const response = await this.get('/v2/everything', {
            q,
            language,
            sortBy,
            pageSize,
        });

        return this._normalizeResponse(response);
    }

    _normalizeResponse(response) {
        if (response.status === 'error') {
            throw new ValidationError(
                response.message || 'NewsAPI error',
                [{ message: response.code }]
            );
        }

        if (!response.articles || response.articles.length === 0) {
            return {
                articles: [],
                totalResults: 0,
                source: 'newsapi',
            };
        }

        const articles = response.articles.map(article => ({
            title: article.title || '',
            description: article.description || '',
            url: article.url || '',
            urlToImage: article.urlToImage || null,
            publishedAt: article.publishedAt || null,
            author: article.author || null,
            sourceName: article.source?.name || 'Unknown',
        }));

        return {
            articles,
            totalResults: response.totalResults || articles.length,
            source: 'newsapi',
        };
    }
}

export default NewsAPIClient;
