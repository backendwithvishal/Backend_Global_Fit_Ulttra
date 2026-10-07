/**
 * Global-Fi Ultra - Dependency Injection Container
 * 
 * Constructor-based DI container that manages all service instances and
 * their dependencies. This is the single location where all application
 * components are wired together.
 * 
 * Architecture Overview:
 * ──────────────────────────────────────────────────────────────────────
 * The container follows a layered initialization pattern:
 * 
 * 1. Infrastructure Layer (bottom)
 *    - Cache (RedisCache)
 *    - Repositories (User, Alert, Watchlist, Asset, AuditLog)
 *    - API Clients (AlphaVantage, CoinGecko, FRED, NewsAPI, Finnhub, ExchangeRate)
 *    - WebSocket Manager (Socket.io)
 * 
 * 2. AI Infrastructure (optional)
 *    - GroqClient → AINewsService, AIMarketService
 *    - AIStreamHandler (WebSocket-based streaming)
 *    - AIJobQueue (RabbitMQ consumer)
 * 
 * 3. Service Layer (middle)
 *    - FinancialDataService, UserService, WatchlistService, AlertService, AssetService
 * 
 * 4. Controller Layer (top)
 *    - HealthController, FinancialController, AdminController, StatusController
 *    - UserController, WatchlistController, AlertController, AssetController
 *    - AIController (optional)
 * 
 * Singleton Pattern:
 * The module exports a `getContainer()` factory function that lazily creates
 * a single Container instance. This ensures all parts of the application
 * share the same service instances.
 * 
 * @module di/container
 */

import { AlphaVantageClient, CoinGeckoClient, ExchangeRateClient, NewsAPIClient, FREDClient, FinnhubClient } from '../infrastructure/http/index.js';
import { RedisCache } from '../infrastructure/cache/index.js';
import {
    AuditLogRepository,
    UserRepository,
    FinancialAssetRepository,
    WatchlistRepository,
    AlertRepository,
    OrganizationRepository,
    InvitationRepository,
    ApiKeyRepository,
    EventLogRepository
} from '../infrastructure/repositories/index.js';
import { SocketManager } from '../infrastructure/websocket/index.js';
import {
    FinancialDataService,
    UserService,
    WatchlistService,
    AlertService,
    AssetService,
    OrganizationService,
    ApiKeyService,
    BillingService,
    KeepAliveService
} from '../services/index.js';
import {
    HealthController,
    FinancialController,
    AdminController,
    StatusController,
    UserController,
    WatchlistController,
    AlertController,
    AssetController,
    AuthController,
    OrganizationController,
    ApiKeyController,
    BillingController
} from '../controllers/index.js';
import { logger } from '../config/logger.js';
import { config } from '../config/environment.js';

// AI Infrastructure — conditionally initialized based on GROQ_API_KEY
import { GroqClient } from '../infrastructure/ai/groqClient.js';
import { AINewsService } from '../services/AINewsService.js';
import { AIMarketService } from '../services/AIMarketService.js';
import { AIStreamHandler } from '../infrastructure/websocket/AIStreamHandler.js';
import { AIJobQueue } from '../infrastructure/messaging/AIJobQueue.js';
import { AIController } from '../controllers/AIController.js';

/**
 * DI Container — manages all service instances and their lifecycle.
 * 
 * Usage:
 * ```js
 * const container = getContainer();
 * await container.initialize({ io });
 * const userController = container.get('userController');
 * ```
 */
export class Container {
    /**
     * Creates a new Container with an empty instance registry.
     */
    constructor() {
        /** @type {Map<string, any>} Registry of all managed service instances */
        this.instances = new Map();
        /** @type {SocketManager|null} WebSocket manager (set during initialization) */
        this.socketManager = null;
        /** @type {AIStreamHandler|null} AI streaming handler (null if AI disabled) */
        this.aiStreamHandler = null;
    }

    /**
     * Initialize all services, repositories, and controllers.
     * 
     * This is the heart of the DI container — it creates every instance
     * in dependency order and wires them together via constructor injection.
     * 
     * AI services are only initialized if `GROQ_API_KEY` is configured.
     * If AI initialization fails, the container gracefully degrades and
     * the rest of the application continues functioning.
     * 
     * @param {Object} options - Initialization options
     * @param {import('socket.io').Server} options.io - Socket.io server instance
     * @returns {Promise<void>}
     */
    async initialize(options) {
        const { io } = options;

        // Callback for circuit breaker state changes — broadcasts to WebSocket clients
        const onCircuitStateChange = (change) => {
            if (this.socketManager) {
                this.socketManager.broadcastCircuitBreakerStateChange(change);
                // Alert connected clients when a circuit breaker trips
                if (change.newState === 'OPEN') {
                    this.socketManager.broadcastSystemWarning({
                        service: change.service,
                        message: `Circuit breaker tripped for ${change.service}`,
                        severity: 'warning',
                    });
                }
            }
        };

        // ─── Layer 1: Infrastructure ─────────────────────────────────
        const cache = new RedisCache();
        const auditLogRepository = new AuditLogRepository();
        const userRepository = new UserRepository();
        const financialAssetRepository = new FinancialAssetRepository();
        const watchlistRepository = new WatchlistRepository();
        const alertRepository = new AlertRepository();
        const organizationRepository = new OrganizationRepository();
        const invitationRepository = new InvitationRepository();
        const apiKeyRepository = new ApiKeyRepository();
        const eventLogRepository = new EventLogRepository();

        // External API clients — each with its own circuit breaker
        const alphaVantageClient = new AlphaVantageClient({ onCircuitStateChange });
        const coinGeckoClient = new CoinGeckoClient({ onCircuitStateChange });
        const exchangeRateClient = new ExchangeRateClient({ onCircuitStateChange });
        const newsAPIClient = new NewsAPIClient({ onCircuitStateChange });
        const fredClient = new FREDClient({ onCircuitStateChange });
        const finnhubClient = new FinnhubClient({ onCircuitStateChange });

        // All API clients in an array for StatusController (circuit breaker status)
        const apiClients = [
            alphaVantageClient,
            coinGeckoClient,
            exchangeRateClient,
            newsAPIClient,
            fredClient,
            finnhubClient,
        ];

        // WebSocket manager for real-time data broadcasting
        this.socketManager = new SocketManager(io);

        // ─── Layer 1.5: AI Infrastructure (Optional) ────────────────
        let groqClient = null;
        let aiNewsService = null;
        let aiMarketService = null;
        let aiJobQueue = null;
        let aiController = null;

        const rawApiKey = (config.ai.groqApiKey || '').trim().replace(/^['"]|['"]$/g, '');
        const isPlaceholder = [
            'your-groq-api-key',
            'your_groq_api_key',
            'your_key_here',
            'your-key-here',
            'gsk_your_groq_api_key_here',
            'gsk_your_key_here',
            'your_api_key_here',
        ].some((placeholder) => rawApiKey.toLowerCase().includes(placeholder));

        const hasValidKeyFormat = rawApiKey.length >= 10 && !isPlaceholder;

        if (hasValidKeyFormat) {
            try {
                logger.info('Initializing AI services...');

                // Create the Groq LLM client
                groqClient = new GroqClient({
                    apiKey: rawApiKey,
                    cacheService: cache,
                    logger
                });

                // AI domain services (depend on GroqClient + Cache)
                aiNewsService = new AINewsService({ groqClient, cacheService: cache });
                aiMarketService = new AIMarketService({ groqClient, cacheService: cache });

                // AI WebSocket streaming handler
                this.aiStreamHandler = new AIStreamHandler({
                    io, groqClient, aiNewsService, aiMarketService
                });
                this.aiStreamHandler.initialize();
                logger.info('✅ AI WebSocket handler initialized');

                // AI job queue (depends on RabbitMQ — may not be available)
                try {
                    aiJobQueue = new AIJobQueue({ aiNewsService, aiMarketService });
                    await aiJobQueue.connect();
                    await aiJobQueue.startConsumers();
                    logger.info('✅ AI job queue initialized');
                } catch (queueError) {
                    logger.warn('⚠️  AI job queue not available (RabbitMQ not connected)', {
                        error: queueError.message
                    });
                    aiJobQueue = null;
                }

                // AI controller (presentation layer for AI endpoints)
                aiController = new AIController({ aiNewsService, aiMarketService, aiJobQueue });
                logger.info('✅ AI services initialized successfully');

                // Validate API key at startup (non-fatal warning if network/rate-limited at boot)
                try {
                    await groqClient.validateApiKey();
                    logger.info('✅ Groq API key validated');
                } catch (valError) {
                    logger.warn('⚠️  Groq API key startup verification failed (requests will attempt live authentication)', {
                        error: valError.message,
                        details: valError.originalError?.message || valError.cause?.message || undefined
                    });
                }
            } catch (error) {
                // Graceful degradation: AI failure doesn't crash the app
                logger.warn('⚠️  Failed to initialize AI services - AI features will be disabled', { 
                    error: error.message,
                    details: error.originalError?.message || error.cause?.message || undefined
                });
                groqClient = null;
                aiNewsService = null;
                aiMarketService = null;
                aiJobQueue = null;
                aiController = null;
                this.aiStreamHandler = null;
            }
        } else {
            logger.info('ℹ️  AI features disabled: GROQ_API_KEY is not configured');
        }

        // ─── Layer 2: Services ───────────────────────────────────────
        const financialDataService = new FinancialDataService({
            alphaVantageClient,
            coinGeckoClient,
            exchangeRateClient,
            newsAPIClient,
            fredClient,
            finnhubClient,
            cache,
            auditLogRepository,
        });

        const userService = new UserService({ userRepository });
        const watchlistService = new WatchlistService({ watchlistRepository });
        const alertService = new AlertService({ alertRepository });
        const assetService = new AssetService({ financialAssetRepository });
        const organizationService = new OrganizationService({ organizationRepository, invitationRepository, userRepository });
        const apiKeyService = new ApiKeyService({ apiKeyRepository });
        const billingService = new BillingService({ userRepository });
        const keepAliveService = new KeepAliveService();

        // ─── Layer 3: Controllers ────────────────────────────────────
        const healthController = new HealthController();
        const financialController = new FinancialController({
            financialDataService,
            socketManager: this.socketManager,
        });
        const adminController = new AdminController({
            cache,
            auditLogRepository,
        });
        const statusController = new StatusController({
            apiClients,
        });
        const userController = new UserController({ userService });
        const watchlistController = new WatchlistController({ watchlistService });
        const alertController = new AlertController({ alertService });
        const assetController = new AssetController({
            assetService,
            financialDataService,
        });
        const authController = new AuthController({ userService });
        const organizationController = new OrganizationController({ organizationService });
        const apiKeyController = new ApiKeyController({ apiKeyService });
        const billingController = new BillingController({ billingService });

        // ─── Register All Instances ──────────────────────────────────
        // Infrastructure
        this.instances.set('cache', cache);
        this.instances.set('auditLogRepository', auditLogRepository);
        this.instances.set('userRepository', userRepository);
        this.instances.set('financialAssetRepository', financialAssetRepository);
        this.instances.set('watchlistRepository', watchlistRepository);
        this.instances.set('alertRepository', alertRepository);
        this.instances.set('organizationRepository', organizationRepository);
        this.instances.set('invitationRepository', invitationRepository);
        this.instances.set('apiKeyRepository', apiKeyRepository);
        this.instances.set('eventLogRepository', eventLogRepository);
        this.instances.set('apiClients', apiClients);

        // Services
        this.instances.set('financialDataService', financialDataService);
        this.instances.set('userService', userService);
        this.instances.set('watchlistService', watchlistService);
        this.instances.set('alertService', alertService);
        this.instances.set('assetService', assetService);
        this.instances.set('organizationService', organizationService);
        this.instances.set('apiKeyService', apiKeyService);
        this.instances.set('billingService', billingService);
        this.instances.set('keepAliveService', keepAliveService);

        // Controllers
        this.instances.set('healthController', healthController);
        this.instances.set('financialController', financialController);
        this.instances.set('adminController', adminController);
        this.instances.set('statusController', statusController);
        this.instances.set('userController', userController);
        this.instances.set('watchlistController', watchlistController);
        this.instances.set('alertController', alertController);
        this.instances.set('assetController', assetController);
        this.instances.set('authController', authController);
        this.instances.set('organizationController', organizationController);
        this.instances.set('apiKeyController', apiKeyController);
        this.instances.set('billingController', billingController);

        // AI instances (may be null if AI is not configured/available)
        this.instances.set('groqClient', groqClient);
        this.instances.set('aiNewsService', aiNewsService);
        this.instances.set('aiMarketService', aiMarketService);
        this.instances.set('aiJobQueue', aiJobQueue);
        this.instances.set('aiController', aiController);

        logger.info('DI Container initialized');
    }

    /**
     * Retrieve a registered service instance by name.
     * 
     * @param {string} name - The registered service name (e.g., 'userController')
     * @returns {any} The service instance, or undefined if not registered
     */
    get(name) {
        return this.instances.get(name);
    }

    /**
     * Get the Socket.io manager instance.
     * 
     * @returns {SocketManager|null} Socket manager, or null if not yet initialized
     */
    getSocketManager() {
        return this.socketManager;
    }

    /**
     * Get the AI streaming WebSocket handler.
     * 
     * @returns {AIStreamHandler|null} AI stream handler, or null if AI is disabled
     */
    getAIStreamHandler() {
        return this.aiStreamHandler;
    }

    /**
     * Check whether AI features are enabled and initialized.
     * 
     * @returns {boolean} True if AIController was successfully created
     */
    isAIEnabled() {
        const controller = this.instances.get('aiController');
        return controller !== null && controller !== undefined;
    }

    /**
     * Gracefully close the AI job queue (RabbitMQ consumer).
     * Called during server shutdown to stop consuming messages.
     * 
     * @returns {Promise<void>}
     */
    async closeAIJobQueue() {
        const aiJobQueue = this.instances.get('aiJobQueue');
        if (aiJobQueue) {
            await aiJobQueue.close();
        }
    }
}

// ─── Singleton Factory ───────────────────────────────────────────────────────

/** @type {Container|null} Singleton container instance */
let container = null;

/**
 * Get or create the singleton Container instance.
 * 
 * Call `.initialize({ io })` on the returned container before using `.get()`.
 * 
 * @returns {Container} The singleton container instance
 */
export const getContainer = () => {
    if (!container) {
        container = new Container();
    }
    return container;
};

export default getContainer;