// RabbitMQ connection management with retry and auto-reconnect logic

import amqp from 'amqplib';
import { config } from './environment.js';
import { logger } from './logger.js';

let connection = null;
let channel = null;
let isClosing = false;
let isConnecting = false;
let reconnectTimer = null;
let reconnectAttempts = 0;

const MAX_RECONNECT_DELAY_MS = 30000;
const INITIAL_RECONNECT_DELAY_MS = 2000;

export const connectRabbitMQ = async (retries = 10, delay = 3000) => {
    if (isClosing) return null;
    if (connection && channel) return { connection, channel };

    const url = config.rabbitmq?.url;
    if (!url || url.trim() === '') {
        logger.info('RabbitMQ URL not configured — running without message queue');
        return null;
    }

    if (url === 'amqp://localhost:5672' || url === 'amqp://localhost' || url.includes('localhost') || url.includes('127.0.0.1')) {
        if (config.server.isProd) {
            logger.warn('RabbitMQ URL points to localhost in production — skipping connection. Set RABBITMQ_URL to the broker hostname (e.g. amqp://user:pass@rabbitmq:5672) to enable async jobs.');
            return null;
        }
    }

    isConnecting = true;

    for (let attempt = 1; attempt <= retries; attempt++) {
        if (isClosing) {
            isConnecting = false;
            return null;
        }

        try {
            const isAmqps = url.startsWith('amqps://');
            const socketOptions = isAmqps ? { rejectUnauthorized: false } : {};

            const conn = await amqp.connect(url, socketOptions);
            const ch = await conn.createChannel();

            connection = conn;
            channel = ch;
            reconnectAttempts = 0;
            isConnecting = false;

            conn.on('error', (err) => {
                logger.error('RabbitMQ connection error', { error: err.message });
                if (!isClosing) {
                    scheduleReconnect();
                }
            });

            conn.on('close', () => {
                channel = null;
                connection = null;
                if (!isClosing) {
                    logger.warn('RabbitMQ connection closed unexpectedly. Scheduling reconnect...');
                    scheduleReconnect();
                } else {
                    logger.info('RabbitMQ connection closed cleanly');
                }
            });

            ch.on('error', (err) => {
                logger.error('RabbitMQ channel error', { error: err.message });
            });

            ch.on('close', () => {
                channel = null;
            });

            // Assert default durable queues
            const prefix = config.rabbitmq?.queuePrefix || 'global_fit_ulttra';
            await ch.assertQueue(`${prefix}-financial-data`, { durable: true });
            await ch.assertQueue(`${prefix}-audit-logs`, { durable: true });
            await ch.assertQueue(`${prefix}-notifications`, { durable: true });
            await ch.assertQueue(`${prefix}-ai-jobs`, { durable: true });

            logger.info('✅ RabbitMQ connection and default queues established');
            return { connection, channel };
        } catch (error) {
            logger.warn(`RabbitMQ connection attempt ${attempt}/${retries} failed`, {
                error: error.message,
            });

            if (attempt === retries) {
                isConnecting = false;
                scheduleReconnect();
                throw new Error(`Failed to connect to RabbitMQ after ${retries} attempts: ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    isConnecting = false;
    return null;
};

const scheduleReconnect = () => {
    if (isClosing || isConnecting || reconnectTimer) return;

    reconnectAttempts++;
    const delay = Math.min(
        INITIAL_RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttempts - 1),
        MAX_RECONNECT_DELAY_MS
    );

    logger.info(`RabbitMQ reconnect attempt ${reconnectAttempts} scheduled in ${Math.round(delay)}ms`);

    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        try {
            await connectRabbitMQ(1, 1000);
        } catch (err) {
            // Next reconnect will be scheduled on failure
        }
    }, delay);
};

export const getRabbitMQChannel = () => channel;

export const getRabbitMQConnection = () => connection;

export const isRabbitMQConnected = () => {
    return connection !== null && channel !== null;
};

export const closeRabbitMQConnection = async () => {
    isClosing = true;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    try {
        if (channel) {
            try {
                await channel.close();
            } catch {
                // Ignore channel close errors
            }
            channel = null;
        }
        if (connection) {
            try {
                await connection.close();
            } catch {
                // Ignore connection close errors
            }
            connection = null;
        }
        logger.info('RabbitMQ connection closed gracefully');
    } catch (error) {
        logger.error('Error closing RabbitMQ connection', { error: error.message });
        throw error;
    } finally {
        isClosing = false;
    }
};

export default {
    connectRabbitMQ,
    getRabbitMQChannel,
    getRabbitMQConnection,
    isRabbitMQConnected,
    closeRabbitMQConnection,
};
