import crypto from 'crypto';
import { logger } from '../config/logger.js';

export class ApiKeyService {
    constructor({ apiKeyRepository }) {
        this.apiKeyRepository = apiKeyRepository;
    }

    async generateKey(userId, organizationId, name, scopes = ['read:financial']) {
        try {
            const randomBytes = crypto.randomBytes(24).toString('hex');
            const plainTextKey = `gfu_live_${randomBytes}`;
            const prefix = 'gfu_live_';
            const keyHash = crypto.createHash('sha256').update(plainTextKey).digest('hex');

            const apiKey = await this.apiKeyRepository.create({
                userId,
                organizationId,
                keyHash,
                name,
                prefix,
                scopes,
                isActive: true,
            });

            return {
                apiKey,
                plainTextKey
            };
        } catch (error) {
            logger.error('Error in ApiKeyService.generateKey', { userId, organizationId, error: error.message });
            throw error;
        }
    }

    async getUserKeys(userId) {
        return this.apiKeyRepository.findByUserId(userId);
    }

    async getOrganizationKeys(orgId) {
        return this.apiKeyRepository.findByOrgId(orgId);
    }

    async getKeyById(keyId) {
        return this.apiKeyRepository.findById(keyId);
    }

    async deactivateKey(keyId) {
        return this.apiKeyRepository.deactivate(keyId);
    }

    async validateKey(plainTextKey) {
        try {
            if (!plainTextKey || !plainTextKey.startsWith('gfu_live_')) {
                return null;
            }

            const keyHash = crypto.createHash('sha256').update(plainTextKey).digest('hex');
            const apiKey = await this.apiKeyRepository.findByHash(keyHash);

            if (!apiKey || !apiKey.isActive) {
                return null;
            }

            // Check expiration
            if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
                await this.apiKeyRepository.deactivate(apiKey._id);
                return null;
            }

            // Update last used timestamp in the background
            await this.apiKeyRepository.updateLastUsed(apiKey._id);

            return {
                userId: apiKey.userId._id,
                organizationId: apiKey.organizationId._id,
                scopes: apiKey.scopes
            };
        } catch (error) {
            logger.error('Error in ApiKeyService.validateKey', { error: error.message });
            return null;
        }
    }
}

export default ApiKeyService;
