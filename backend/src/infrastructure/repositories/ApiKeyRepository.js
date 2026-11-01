import { ApiKey } from '../../models/index.js';
import { logger } from '../../config/logger.js';

export class ApiKeyRepository {
    async create(keyData) {
        try {
            const apiKey = new ApiKey(keyData);
            await apiKey.save();
            logger.info('API Key registered', { keyId: apiKey._id, prefix: apiKey.prefix });
            return apiKey;
        } catch (error) {
            logger.error('Error in ApiKeyRepository.create', { error: error.message });
            throw error;
        }
    }

    async findByHash(keyHash) {
        try {
            return await ApiKey.findOne({ keyHash, isActive: true })
                .populate('userId', 'email isActive')
                .populate('organizationId', 'name');
        } catch (error) {
            logger.error('Error in ApiKeyRepository.findByHash', { error: error.message });
            throw error;
        }
    }

    async findByOrgId(organizationId) {
        try {
            return await ApiKey.find({ organizationId });
        } catch (error) {
            logger.error('Error in ApiKeyRepository.findByOrgId', { organizationId, error: error.message });
            throw error;
        }
    }

    async findByUserId(userId) {
        try {
            return await ApiKey.find({ userId });
        } catch (error) {
            logger.error('Error in ApiKeyRepository.findByUserId', { userId, error: error.message });
            throw error;
        }
    }

    async findById(id) {
        try {
            return await ApiKey.findById(id);
        } catch (error) {
            logger.error('Error in ApiKeyRepository.findById', { id, error: error.message });
            throw error;
        }
    }

    async deactivate(id) {
        try {
            return await ApiKey.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true });
        } catch (error) {
            logger.error('Error in ApiKeyRepository.deactivate', { id, error: error.message });
            throw error;
        }
    }

    async delete(id) {
        try {
            return await ApiKey.findByIdAndDelete(id);
        } catch (error) {
            logger.error('Error in ApiKeyRepository.delete', { id, error: error.message });
            throw error;
        }
    }

    async updateLastUsed(id) {
        try {
            return await ApiKey.findByIdAndUpdate(id, { $set: { lastUsedAt: new Date() } }, { new: true });
        } catch (error) {
            logger.error('Error in ApiKeyRepository.updateLastUsed', { id, error: error.message });
            throw error;
        }
    }
}

export default ApiKeyRepository;
