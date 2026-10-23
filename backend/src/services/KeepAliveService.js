/**
 * Global_Fit_Ulttra - KeepAlive Service
 *
 * Automated background service to keep backend instances awake on cloud platforms
 * (e.g., Render, Railway, Heroku) that spin down free services after periods of inactivity.
 *
 * Features:
 * 1. Internal self-ping loop sending HTTP GET requests to configured server URL.
 * 2. Safe start/stop lifecycle management integrated into server startup & shutdown.
 * 3. Detailed logging of keep-alive status, response latency, and health check state.
 *
 * @module services/KeepAliveService
 */

import { logger } from '../config/logger.js';
import { config } from '../config/environment.js';

export class KeepAliveService {
    /**
     * @param {Object} [options]
     * @param {boolean} [options.enabled] - Whether keep-alive timer is active
     * @param {string} [options.url] - Target endpoint URL to ping
     * @param {number} [options.intervalMs] - Ping interval in milliseconds
     */
    constructor(options = {}) {
        this.enabled = options.enabled ?? config.keepAlive.enabled;
        this.url = options.url || config.keepAlive.url;
        this.intervalMs = options.intervalMs || config.keepAlive.intervalMs || 600000; // 10 minutes default
        this.timer = null;
        this.isPinging = false;
    }

    /**
     * Starts the automated keep-alive background task if enabled.
     */
    start() {
        if (this.timer) {
            logger.warn('KeepAliveService is already running');
            return;
        }

        if (!this.enabled && !this.url) {
            logger.info('KeepAliveService is disabled (KEEP_ALIVE_ENABLED=false & KEEP_ALIVE_URL is empty)');
            return;
        }

        logger.info(`KeepAliveService starting up. Target: ${this.url || '[auto-detect]'}, Interval: ${this.intervalMs / 1000}s`);

        // Schedule periodic self-ping loop
        this.timer = setInterval(() => {
            this.executePing();
        }, this.intervalMs);

        // Execute first ping after 15 seconds to allow initial server startup to complete
        setTimeout(() => {
            if (this.timer) {
                this.executePing();
            }
        }, 15000);
    }

    /**
     * Executes a single ping request to keep backend active.
     */
    async executePing() {
        if (this.isPinging) return;
        this.isPinging = true;

        const defaultUrl = process.env.RENDER_EXTERNAL_URL 
            ? `${process.env.RENDER_EXTERNAL_URL}/api/v1/health/ping` 
            : `http://localhost:${config.server.port}/api/v1/health/ping`;
        const targetUrl = this.url || defaultUrl;
        const startTime = Date.now();

        try {
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'GlobalFitUlttra-KeepAlive-Service/1.0',
                    'Accept': 'application/json',
                },
            });

            const latency = Date.now() - startTime;
            if (response.ok) {
                logger.info(`[KeepAlive] Ping successful to ${targetUrl} (${response.status} OK - ${latency}ms)`);
            } else {
                logger.warn(`[KeepAlive] Ping returned status ${response.status} from ${targetUrl}`);
            }
        } catch (error) {
            logger.error(`[KeepAlive] Ping failed to ${targetUrl}: ${error.message}`);
        } finally {
            this.isPinging = false;
        }
    }

    /**
     * Stops the background keep-alive task.
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logger.info('KeepAliveService stopped');
        }
    }
}

export default KeepAliveService;
