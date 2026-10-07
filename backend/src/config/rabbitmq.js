// RabbitMQ connection management with retry logic

import amqp from 'amqplib';
import { config } from './environment.js';
import { logger } from './logger.js';

let connection = null;
let channel = null;

export const connectRabbitMQ = async (retries = 5, delay = 3000) => {
    // Skip connection if no real RabbitMQ URL is configured
    const url = config.rabbitmq.url;
    if (!url || url === 'amqp://localhost:5672' || url === 'amqp://localhost' || url.includes('localhost') || url.includes('127.0.0.1')) {
        if (config.server.isProd) {
            logger.info('RabbitMQ URL not configured for production environment — skipping connection (async AI jobs disabled)');
            return null;
        }
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const url = config.rabbitmq.url;
            const isAmqps = url.startsWith('amqps://');
            const socketOptions = isAmqps ? { rejectUnauthorized: false } : {};

            connection = await amqp.connect(url, socketOptions);
            channel = await connection.createChannel();

            connection.on('error', (err) => {
                logger.error('RabbitMQ connection error', { error: err.message });
            });

            connection.on('close', () => {
                logger.warn('RabbitMQ connection closed');
                channel = null;
                connection = null;
            });

            // Assert default queues
            const prefix = config.rabbitmq.queuePrefix;
            await channel.assertQueue(`${prefix}-financial-data`, { durable: true });
            await channel.assertQueue(`${prefix}-audit-logs`, { durable: true });
            await channel.assertQueue(`${prefix}-notifications`, { durable: true });

            logger.info('RabbitMQ connection established');
            return { connection, channel };
        } catch (error) {
            logger.error(`RabbitMQ connection failed (attempt ${attempt}/${retries})`, {
                error: error.message
            });

            if (attempt === retries) {
                throw new Error(`Failed to connect to RabbitMQ after ${retries} attempts: ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

export const getRabbitMQChannel = () => channel;

export const getRabbitMQConnection = () => connection;

export const isRabbitMQConnected = () => connection !== null && channel !== null;

export const closeRabbitMQConnection = async () => {
    try {
        if (channel) {
            await channel.close();
            channel = null;
        }
        if (connection) {
            await connection.close();
            connection = null;
        }
        logger.info('RabbitMQ connection closed');
    } catch (error) {
        logger.error('Error closing RabbitMQ connection', { error: error.message });
        throw error;
    }
};
