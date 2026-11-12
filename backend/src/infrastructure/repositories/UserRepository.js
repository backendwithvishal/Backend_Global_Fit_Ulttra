// User repository - database operations for User model

import { User } from '../../models/index.js';
import { logger } from '../../config/logger.js';
import { config } from '../../config/environment.js';

export class UserRepository {
    // Create new user
    async create(userData) {
        try {
            // Hash password before saving if provided as plain text
            const dataToSave = { ...userData };
            if (dataToSave.password) {
                const bcrypt = await import('bcrypt');
                const rounds = config.security?.bcryptRounds || 12;
                dataToSave.passwordHash = await bcrypt.default.hash(dataToSave.password, rounds);
                delete dataToSave.password;
            }

            const user = new User(dataToSave);
            await user.save();
            logger.info('User created', { userId: user._id, email: user.email });
            return user;
        } catch (error) {
            logger.error('Error creating user', { error: error.message });
            throw error;
        }
    }

    // Find user by ID
    async findById(id) {
        try {
            return await User.findById(id);
        } catch (error) {
            logger.error('Error finding user by ID', { id, error: error.message });
            throw error;
        }
    }

    // Find user by email
    async findByEmail(email) {
        try {
            return await User.findOne({ email: email.toLowerCase() });
        } catch (error) {
            logger.error('Error finding user by email', { email, error: error.message });
            throw error;
        }
    }

    // Find user by email with password field (for login)
    async findByEmailWithPassword(email) {
        try {
            return await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
        } catch (error) {
            logger.error('Error finding user by email with password', { email, error: error.message });
            throw error;
        }
    }

    // Find all users with pagination
    async findAll({ page = 1, limit = 20, filter = {}, sort = '-createdAt' } = {}) {
        try {
            const skip = (page - 1) * limit;

            const [users, total] = await Promise.all([
                User.find(filter)
                    .sort(sort)
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                User.countDocuments(filter),
            ]);

            return {
                users,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit),
                },
            };
        } catch (error) {
            logger.error('Error finding users', { error: error.message });
            throw error;
        }
    }

    // Update user by ID
    async update(id, updateData) {
        try {
            const user = await User.findByIdAndUpdate(
                id,
                { $set: updateData },
                { new: true, runValidators: true }
            );

            if (user) {
                logger.info('User updated', { userId: id });
            }

            return user;
        } catch (error) {
            logger.error('Error updating user', { id, error: error.message });
            throw error;
        }
    }

    // Soft delete user (set isActive = false)
    async delete(id) {
        try {
            const user = await User.findByIdAndUpdate(
                id,
                { $set: { isActive: false } },
                { new: true }
            );

            if (user) {
                logger.info('User soft deleted', { userId: id });
            }

            return user;
        } catch (error) {
            logger.error('Error deleting user', { id, error: error.message });
            throw error;
        }
    }

    // Hard delete user (permanent removal)
    async hardDelete(id) {
        try {
            const result = await User.findByIdAndDelete(id);

            if (result) {
                logger.warn('User hard deleted', { userId: id });
                return true;
            }

            return false;
        } catch (error) {
            logger.error('Error hard deleting user', { id, error: error.message });
            throw error;
        }
    }

    // Check if email exists (optionally exclude a user ID)
    async emailExists(email, excludeId = null) {
        try {
            const query = { email: email.toLowerCase() };
            if (excludeId) {
                query._id = { $ne: excludeId };
            }

            const count = await User.countDocuments(query);
            return count > 0;
        } catch (error) {
            logger.error('Error checking email existence', { email, error: error.message });
            throw error;
        }
    }

    // Find user by verification token
    async findByVerificationToken(token) {
        try {
            return await User.findOne({ emailVerificationToken: token }).select('+emailVerificationToken');
        } catch (error) {
            logger.error('Error finding user by verification token', { error: error.message });
            throw error;
        }
    }

    // Find user by reset token
    async findByResetToken(token) {
        try {
            return await User.findOne({ passwordResetToken: token }).select('+passwordResetToken +passwordResetExpires');
        } catch (error) {
            logger.error('Error finding user by reset token', { error: error.message });
            throw error;
        }
    }

    // Find user by magic link token
    async findByMagicToken(token) {
        try {
            return await User.findOne({ 'metadata.magicToken': token });
        } catch (error) {
            logger.error('Error finding user by magic token', { error: error.message });
            throw error;
        }
    }

    // Find by ID and select specific fields
    async findByIdWithFields(id, fields = []) {
        try {
            const selectString = fields.join(' ');
            return await User.findById(id).select(selectString);
        } catch (error) {
            logger.error('Error finding user with fields', { id, fields, error: error.message });
            throw error;
        }
    }
}

export default UserRepository;
