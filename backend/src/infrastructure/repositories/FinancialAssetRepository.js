// Financial asset repository for database operations

import { FinancialAsset } from '../../models/index.js';
import { logger } from '../../config/logger.js';

export class FinancialAssetRepository {
    async create(assetData) {
        try {
            const asset = new FinancialAsset(assetData);
            await asset.save();
            logger.info('Financial asset created', { symbol: asset.symbol, type: asset.type });
            return asset;
        } catch (error) {
            logger.error('Error creating financial asset', { error: error.message });
            throw error;
        }
    }

    async findBySymbol(symbol) {
        try {
            return await FinancialAsset.findOne({ symbol: symbol.toUpperCase() });
        } catch (error) {
            logger.error('Error finding asset by symbol', { symbol, error: error.message });
            throw error;
        }
    }

    async findById(id) {
        try {
            return await FinancialAsset.findById(id);
        } catch (error) {
            logger.error('Error finding asset by ID', { id, error: error.message });
            throw error;
        }
    }

    async findAll({ page = 1, limit = 20, filter = {}, sort = '-createdAt', search = '' } = {}) {
        try {
            const skip = (page - 1) * limit;

            if (search) {
                const sanitizedSearch = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim();
                if (sanitizedSearch) {
                    filter.$or = [
                        { symbol: { $regex: sanitizedSearch, $options: 'i' } },
                        { name: { $regex: sanitizedSearch, $options: 'i' } },
                    ];
                }
            }

            const [assets, total] = await Promise.all([
                FinancialAsset.find(filter)
                    .sort(sort)
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                FinancialAsset.countDocuments(filter),
            ]);

            return {
                assets,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit),
                },
            };
        } catch (error) {
            logger.error('Error finding assets', { error: error.message });
            throw error;
        }
    }

    async updateBySymbol(symbol, updateData) {
        try {
            const asset = await FinancialAsset.findOneAndUpdate(
                { symbol: symbol.toUpperCase() },
                { $set: updateData },
                { new: true, runValidators: true }
            );

            if (asset) {
                logger.info('Financial asset updated', { symbol });
            }

            return asset;
        } catch (error) {
            logger.error('Error updating asset', { symbol, error: error.message });
            throw error;
        }
    }

    async updatePrice(symbol, price, source = 'api') {
        try {
            const asset = await this.findBySymbol(symbol);

            if (!asset) {
                return null;
            }

            await asset.updatePrice(price, source);
            logger.info('Asset price updated', { symbol, price, source });

            return asset;
        } catch (error) {
            logger.error('Error updating asset price', { symbol, error: error.message });
            throw error;
        }
    }

    async bulkUpdatePrices(updates) {
        try {
            let updated = 0;

            for (const { symbol, price, source } of updates) {
                const result = await this.updatePrice(symbol, price, source);
                if (result) updated++;
            }

            logger.info('Bulk price update completed', { total: updates.length, updated });
            return updated;
        } catch (error) {
            logger.error('Error in bulk price update', { error: error.message });
            throw error;
        }
    }

    async deleteBySymbol(symbol) {
        try {
            const asset = await FinancialAsset.findOneAndUpdate(
                { symbol: symbol.toUpperCase() },
                { $set: { isActive: false } },
                { new: true }
            );

            if (asset) {
                logger.info('Financial asset soft deleted', { symbol });
            }

            return asset;
        } catch (error) {
            logger.error('Error deleting asset', { symbol, error: error.message });
            throw error;
        }
    }

    async findByType(type, { limit = 100, isActive = true } = {}) {
        try {
            return await FinancialAsset.find({ type, isActive })
                .sort('-lastUpdated')
                .limit(limit)
                .lean();
        } catch (error) {
            logger.error('Error finding assets by type', { type, error: error.message });
            throw error;
        }
    }
}

export default FinancialAssetRepository;
