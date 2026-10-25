// Environment configuration with Zod validation
// Single source of truth for all config values

import 'dotenv/config';
import { z } from 'zod';

// Zod schema for all environment variables
// All numeric values are strings with .transform(Number) because process.env values are always strings
const envSchema = z.object({
  // Server config
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('4000'),
  HOST: z.string().default('0.0.0.0'),

  // MongoDB
  MONGODB_URI: z.string().transform(v => v.trim() || 'mongodb://localhost:27017/global_fit_ulttra').default('mongodb://localhost:27017/global_fit_ulttra'),
  MONGODB_POOL_SIZE: z.string().transform(Number).default('10'),

  // Redis
  REDIS_URL: z.string().transform(v => v.trim().replace(/^['"]|['"]$/g, '')).default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().transform(v => v ? v.trim().replace(/^['"]|['"]$/g, '') : '').optional().default(''),
  REDIS_TTL_DEFAULT: z.string().transform(Number).default('300'),

  // External API keys
  ALPHA_VANTAGE_API_KEY: z.string().default('demo'),
  COINGECKO_API_KEY: z.string().optional().default(''),
  NEWS_API_KEY: z.string().default(''),
  FRED_API_KEY: z.string().default(''),
  FINNHUB_API_KEY: z.string().default(''),

  // Security
  CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:5173,https://backend-global-fit-ulttra.onrender.com'),
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),

  // JWT Authentication
  JWT_SECRET: z.string().default('global-fit-ulttra-dev-secret-change-in-production'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Circuit breaker
  CIRCUIT_BREAKER_THRESHOLD: z.string().transform(Number).default('3'),
  CIRCUIT_BREAKER_TIMEOUT: z.string().transform(Number).default('30000'),
  CIRCUIT_BREAKER_RESET_TIMEOUT: z.string().transform(Number).default('30000'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  LOG_FILE_PATH: z.string().default('./logs/app.log'),

  // Socket.io
  SOCKET_IO_CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:5173,https://backend-global-fit-ulttra.onrender.com'),

  // Feature flags
  ENABLE_CACHE_WARMING: z.string().transform(v => v === 'true').default('false'),
  ENABLE_METRICS_COLLECTION: z.string().transform(v => v === 'true').default('true'),

  // RabbitMQ
  RABBITMQ_URL: z.string().transform(v => v.trim().replace(/^['"]|['"]$/g, '')).default('amqp://localhost:5672'),
  RABBITMQ_QUEUE_PREFIX: z.string().transform(v => v.trim().replace(/^['"]|['"]$/g, '')).default('global_fit_ulttra'),

  // Groq AI
  GROQ_API_KEY: z.string().default(''),
  GROQ_PRIMARY_MODEL: z.string().default('llama-3.3-70b-versatile'),
  GROQ_FAST_MODEL: z.string().default('llama-3.1-8b-instant'),

  // Qdrant Vector Database
  QDRANT_URL: z.string().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional().default(''),
  QDRANT_COLLECTION: z.string().default('global_fit_ulttra_financial_documents'),
  QDRANT_ENABLED: z.string().transform(v => v === 'true').default('true'),

  // LiteLLM AI Gateway (Self-hosted, free, open-source proxy)
  LITELLM_ENABLED: z.string().transform(v => v === 'true').default('false'),
  LITELLM_URL: z.string().default('http://localhost:8000/v1'),
  LITELLM_API_KEY: z.string().optional().default(''),


  // LangSmith Tracing & Observability (Optional)
  LANGSMITH_API_KEY: z.string().optional().default(''),
  LANGSMITH_PROJECT: z.string().default('global-fit-ulttra-rag'),
  LANGSMITH_ENDPOINT: z.string().default('https://api.smith.langchain.com'),
  LANGSMITH_ENABLED: z.string().transform(v => v === 'true').default('false'),

  // RAG & Vector Search Configuration
  EMBEDDING_PROVIDER: z.enum(['local', 'openai', 'voyage', 'huggingface']).default('local'),
  EMBEDDING_API_KEY: z.string().optional().default(''),
  EMBEDDING_MODEL: z.string().default('Xenova/all-MiniLM-L6-v2'),
  COHERE_API_KEY: z.string().optional().default(''),
  RAG_SEMANTIC_CACHE_ENABLED: z.string().transform(v => v === 'true').default('true'),
  RAG_SIMILARITY_THRESHOLD: z.string().transform(Number).default('0.65'),
  RAG_RRF_DENSE_WEIGHT: z.string().transform(Number).default('0.65'),
  RAG_RRF_SPARSE_WEIGHT: z.string().transform(Number).default('0.35'),
  RAG_RRF_K: z.string().transform(Number).default('60'),
  RAG_CONFIDENCE_THRESHOLD: z.string().transform(Number).default('0.40'),
  RAG_MAX_AGENT_ITERATIONS: z.string().transform(Number).default('3'),

  // Keep-Alive self pinging (prevents server sleep in production)
  KEEP_ALIVE_ENABLED: z.string().transform(v => v === 'true').default('true'),
  KEEP_ALIVE_URL: z.string().default('https://backend-global-fit-ulttra.onrender.com/api/v1/health/ping'),
  KEEP_ALIVE_INTERVAL_MS: z.string().transform(Number).default('600000'),
});

// Parse and validate environment variables
// Exits with code 1 if validation fails
const parseEnv = () => {
  // Support deployment aliases for seamless backwards compatibility
  if (!process.env.LITELLM_URL && process.env.LITELLM_BASE_URL) {
    process.env.LITELLM_URL = process.env.LITELLM_BASE_URL;
  }
  if (!process.env.LANGSMITH_API_KEY && process.env.LANGCHAIN_API_KEY) {
    process.env.LANGSMITH_API_KEY = process.env.LANGCHAIN_API_KEY;
  }
  if (!process.env.LANGSMITH_PROJECT && process.env.LANGCHAIN_PROJECT) {
    process.env.LANGSMITH_PROJECT = process.env.LANGCHAIN_PROJECT;
  }
  if (!process.env.LANGSMITH_ENABLED && process.env.LANGCHAIN_TRACING_V2) {
    process.env.LANGSMITH_ENABLED = process.env.LANGCHAIN_TRACING_V2;
  }
  if (!process.env.RAG_MAX_AGENT_ITERATIONS && process.env.RAG_MAX_ITERATIONS) {
    process.env.RAG_MAX_AGENT_ITERATIONS = process.env.RAG_MAX_ITERATIONS;
  }
  if (!process.env.RAG_RRF_DENSE_WEIGHT && process.env.RAG_DENSE_WEIGHT) {
    process.env.RAG_RRF_DENSE_WEIGHT = process.env.RAG_DENSE_WEIGHT;
  }
  if (!process.env.RAG_RRF_SPARSE_WEIGHT && process.env.RAG_SPARSE_WEIGHT) {
    process.env.RAG_RRF_SPARSE_WEIGHT = process.env.RAG_SPARSE_WEIGHT;
  }
  if (!process.env.EMBEDDING_MODEL && process.env.LOCAL_EMBEDDING_MODEL) {
    process.env.EMBEDDING_MODEL = process.env.LOCAL_EMBEDDING_MODEL;
  }
  if (!process.env.EMBEDDING_API_KEY && process.env.HUGGINGFACE_API_KEY) {
    process.env.EMBEDDING_API_KEY = process.env.HUGGINGFACE_API_KEY;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  const data = result.data;
  // Ensure server binds to 0.0.0.0 in production to satisfy container & Render port scanner requirements
  if (data.NODE_ENV === 'production' && (data.HOST === 'localhost' || data.HOST === '127.0.0.1')) {
    data.HOST = '0.0.0.0';
  }

  // Warn loudly if JWT_SECRET is the development default in production
  const DEV_JWT_SECRET = 'global-fit-ulttra-dev-secret-change-in-production';
  if (data.NODE_ENV === 'production' && data.JWT_SECRET === DEV_JWT_SECRET) {
    console.error('❌ SECURITY ERROR: JWT_SECRET is still set to the development default in production.');
    console.error('   Set a strong random JWT_SECRET in your production environment variables.');
    console.error('   Generate one: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    process.exit(1);
  }

  return data;
};

export const env = parseEnv();

// Structured config object for easy access
// Import this instead of accessing process.env directly
export const config = {
  server: {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    isDev: env.NODE_ENV === 'development',
    isProd: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
  },

  database: {
    uri: env.MONGODB_URI,
    poolSize: env.MONGODB_POOL_SIZE,
  },

  redis: {
    url: env.REDIS_URL,
    password: env.REDIS_PASSWORD,
    ttlDefault: env.REDIS_TTL_DEFAULT,
  },

  apiKeys: {
    alphaVantage: env.ALPHA_VANTAGE_API_KEY,
    coinGecko: env.COINGECKO_API_KEY,
    newsApi: env.NEWS_API_KEY,
    fred: env.FRED_API_KEY,
    finnhub: env.FINNHUB_API_KEY,
  },

  security: {
    corsOrigins: env.CORS_ORIGIN.split(',').map(s => s.trim()),
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: env.RATE_LIMIT_MAX_REQUESTS,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
  },

  circuitBreaker: {
    threshold: env.CIRCUIT_BREAKER_THRESHOLD,
    timeout: env.CIRCUIT_BREAKER_TIMEOUT,
    resetTimeout: env.CIRCUIT_BREAKER_RESET_TIMEOUT,
  },

  logging: {
    level: env.LOG_LEVEL,
    filePath: env.LOG_FILE_PATH,
  },

  socketIo: {
    corsOrigins: env.SOCKET_IO_CORS_ORIGIN.split(',').map(s => s.trim()),
  },

  features: {
    cacheWarming: env.ENABLE_CACHE_WARMING,
    metricsCollection: env.ENABLE_METRICS_COLLECTION,
  },

  rabbitmq: {
    url: env.RABBITMQ_URL,
    queuePrefix: env.RABBITMQ_QUEUE_PREFIX,
  },

  ai: {
    groqApiKey: env.GROQ_API_KEY,
    primaryModel: env.GROQ_PRIMARY_MODEL,
    fastModel: env.GROQ_FAST_MODEL,
  },

  qdrant: {
    url: env.QDRANT_URL,
    apiKey: env.QDRANT_API_KEY,
    collection: env.QDRANT_COLLECTION,
    enabled: env.QDRANT_ENABLED,
  },

  litellm: {
    enabled: env.LITELLM_ENABLED,
    url: env.LITELLM_URL,
    apiKey: env.LITELLM_API_KEY,
  },


  langsmith: {
    apiKey: env.LANGSMITH_API_KEY,
    project: env.LANGSMITH_PROJECT,
    endpoint: env.LANGSMITH_ENDPOINT,
    enabled: env.LANGSMITH_ENABLED,
  },

  rag: {
    embeddingProvider: env.EMBEDDING_PROVIDER,
    embeddingApiKey: env.EMBEDDING_API_KEY,
    embeddingModel: env.EMBEDDING_MODEL,
    cohereApiKey: env.COHERE_API_KEY,
    semanticCacheEnabled: env.RAG_SEMANTIC_CACHE_ENABLED,
    similarityThreshold: env.RAG_SIMILARITY_THRESHOLD,
    rrfDenseWeight: env.RAG_RRF_DENSE_WEIGHT,
    rrfSparseWeight: env.RAG_RRF_SPARSE_WEIGHT,
    rrfK: env.RAG_RRF_K,
    confidenceThreshold: env.RAG_CONFIDENCE_THRESHOLD,
    maxAgentIterations: env.RAG_MAX_AGENT_ITERATIONS,
  },

  keepAlive: {
    enabled: env.KEEP_ALIVE_ENABLED,
    url: env.KEEP_ALIVE_URL,
    intervalMs: env.KEEP_ALIVE_INTERVAL_MS,
  },

  // Cache TTL values in seconds
  // Shorter for volatile data (crypto, stocks), longer for slow-changing data (economic indicators)
  cacheTTL: {
    alphaVantage: 60,     // Stock quotes: 1 minute
    coinGecko: 30,        // Crypto prices: 30 seconds
    exchangeRate: 300,    // Forex rates: 5 minutes
    newsApi: 600,         // News: 10 minutes
    fred: 1800,           // Economic data: 30 minutes
    finnhub: 600,         // Finnhub data: 10 minutes
  },
};

export default config;
