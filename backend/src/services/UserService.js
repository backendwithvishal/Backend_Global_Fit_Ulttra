import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { logger } from '../config/logger.js';
import { config } from '../config/environment.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const generateBase32Secret = (length = 16) => {
    const bytes = crypto.randomBytes(length);
    let secret = '';
    for (let i = 0; i < length; i++) {
        secret += BASE32_ALPHABET[bytes[i] % 32];
    }
    return secret;
};

export const base32ToBuffer = (base32Str) => {
    if (!base32Str || typeof base32Str !== 'string') return Buffer.alloc(0);
    const cleaned = base32Str.toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = '';
    for (let i = 0; i < cleaned.length; i++) {
        const val = BASE32_ALPHABET.indexOf(cleaned[i]);
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    return Buffer.from(bytes);
};

export class UserService {
    constructor({ userRepository }) {
        this.userRepository = userRepository;
    }

    generateBase32Secret(length = 16) {
        return generateBase32Secret(length);
    }

    base32ToBuffer(base32Str) {
        return base32ToBuffer(base32Str);
    }

    // Create new user - enforces email uniqueness and sets verification token
    async createUser(userData) {
        try {
            const exists = await this.userRepository.emailExists(userData.email);
            if (exists) {
                throw new Error('Email already in use');
            }

            // Generate email verification token
            const verificationToken = crypto.randomBytes(32).toString('hex');
            // Strict mass-assignment prevention: allowlist safe registration attributes only
            const dataToSave = {
                email: userData.email,
                firstName: userData.firstName,
                lastName: userData.lastName,
                password: userData.password,
                preferences: userData.preferences || {},
                role: 'Member',
                subscriptionTier: 'Free',
                isEmailVerified: false,
                emailVerificationToken: verificationToken,
            };

            const user = await this.userRepository.create(dataToSave);
            logger.info('User created successfully', { userId: user._id });
            
            // Safe logging without exposing secret tokens in plaintext logs
            logger.info('[MAILER MOCK] Verification link generated', { email: user.email });

            const userObj = typeof user.toObject === 'function' ? user.toObject() : { ...user };
            delete userObj.passwordHash;
            delete userObj.twoFactorSecret;
            delete userObj.twoFactorBackupCodes;

            // Generate JWT access & refresh tokens
            const { accessToken, refreshToken } = this._generateTokenPair(user);

            // Store refresh token and active session
            await this._storeRefreshToken(user, refreshToken, '127.0.0.1', 'Initial Registration');
            const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
            if (!user.activeSessions) {
                user.activeSessions = [];
            }
            user.activeSessions.push({
                tokenHash,
                device: 'Initial Registration',
                createdAt: new Date(),
            });
            if (typeof user.save === 'function') {
                await user.save();
            }

            return { accessToken, refreshToken, token: accessToken, user: userObj };
        } catch (error) {
            logger.error('Error in createUser', { error: error.message });
            throw error;
        }
    }

    // Verify user's email
    async verifyEmail(token) {
        try {
            const user = await this.userRepository.findByVerificationToken(token);
            if (!user) {
                throw new Error('Invalid or expired verification token');
            }

            user.isEmailVerified = true;
            user.emailVerificationToken = undefined;
            await user.save();

            logger.info('Email verified successfully', { userId: user._id });
            return user;
        } catch (error) {
            logger.error('Error in verifyEmail', { error: error.message });
            throw error;
        }
    }

    // Generate password reset token
    async requestPasswordReset(email) {
        try {
            const user = await this.userRepository.findByEmail(email);
            if (!user) {
                throw new Error('User not found');
            }

            const resetToken = crypto.randomBytes(32).toString('hex');
            user.passwordResetToken = resetToken;
            user.passwordResetExpires = Date.now() + 3600000; // 1 hour expiration
            await user.save();

            // Safe logging without leaking plaintext token into log monitors
            logger.info('[MAILER MOCK] Password reset link generated', { email });
            return true;
        } catch (error) {
            logger.error('Error in requestPasswordReset', { email, error: error.message });
            throw error;
        }
    }

    // Reset password using token
    async resetPassword(token, newPassword) {
        try {
            const user = await this.userRepository.findByResetToken(token);
            if (!user || user.passwordResetExpires < Date.now()) {
                throw new Error('Invalid or expired reset token');
            }

            // Set new password with verified bcrypt cost >= 12
            const rounds = config.security.bcryptRounds || 12;
            const bcrypt = await import('bcrypt');
            user.passwordHash = await bcrypt.default.hash(newPassword, rounds);
            user.passwordResetToken = undefined;
            user.passwordResetExpires = undefined;
            await user.save();

            logger.info('Password reset successful', { userId: user._id });
            return true;
        } catch (error) {
            logger.error('Error in resetPassword', { error: error.message });
            throw error;
        }
    }

    // Two-factor authentication key generation
    async generateMfaSecret(userId) {
        try {
            const user = await this.getUser(userId);
            
            // Standard Base32 secret generation for Google Authenticator compatibility (RFC 3548)
            const secret = generateBase32Secret(16);
            
            user.twoFactorSecret = secret;
            await user.save();

            // OTPAuth URI standard: otpauth://totp/Issuer:Email?secret=Secret&issuer=Issuer
            const otpauthUrl = `otpauth://totp/GlobalFitUlttra:${user.email}?secret=${secret}&issuer=GlobalFitUlttra`;
            
            return { secret, otpauthUrl };
        } catch (error) {
            logger.error('Error in generateMfaSecret', { userId, error: error.message });
            throw error;
        }
    }

    // Enable/Confirm MFA with a verification code
    async enableMfa(userId, code) {
        try {
            const user = await this.userRepository.findByIdWithFields(userId, ['+twoFactorSecret']);
            if (!user || !user.twoFactorSecret) {
                throw new Error('MFA secret not initialized');
            }

            // Validate TOTP
            const isValid = this._verifyTOTP(user.twoFactorSecret, code);
            if (!isValid) {
                throw new Error('Invalid verification code');
            }

            user.isTwoFactorEnabled = true;
            // Generate backup codes
            const backupCodes = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString('hex').toUpperCase());
            user.twoFactorBackupCodes = backupCodes;
            await user.save();

            logger.info('MFA enabled for user', { userId });
            return { backupCodes };
        } catch (error) {
            logger.error('Error in enableMfa', { userId, error: error.message });
            throw error;
        }
    }

    // Disable MFA
    async disableMfa(userId, code) {
        try {
            const user = await this.userRepository.findByIdWithFields(userId, ['+twoFactorSecret']);
            if (!user) {
                throw new Error('User not found');
            }

            // Verify code before disabling
            if (user.isTwoFactorEnabled) {
                const isValid = this._verifyTOTP(user.twoFactorSecret, code);
                if (!isValid) {
                    throw new Error('Invalid verification code');
                }
            }

            user.isTwoFactorEnabled = false;
            user.twoFactorSecret = undefined;
            user.twoFactorBackupCodes = [];
            await user.save();

            logger.info('MFA disabled for user', { userId });
            return true;
        } catch (error) {
            logger.error('Error in disableMfa', { userId, error: error.message });
            throw error;
        }
    }

    // Helper: Generate Access and Refresh token pair
    _generateTokenPair(user) {
        const payload = {
            userId: user._id ? user._id.toString() : user.id,
            email: user.email,
            role: user.role || 'Member',
            organizationId: user.organizationId ? user.organizationId.toString() : null,
            subscriptionTier: user.subscriptionTier || 'Free',
        };

        const accessSecret = config.security.jwtAccessSecret;
        const refreshSecret = config.security.jwtRefreshSecret;

        const accessToken = jwt.sign(payload, accessSecret, {
            expiresIn: config.security.jwtExpiresIn || '15m',
        });

        const refreshPayload = {
            userId: payload.userId,
            tokenType: 'refresh',
            jti: crypto.randomUUID(),
        };

        const refreshToken = jwt.sign(refreshPayload, refreshSecret, {
            expiresIn: config.security.jwtRefreshExpiresIn || '7d',
        });

        return { accessToken, refreshToken, payload };
    }

    // Helper: Store hashed refresh token in database
    async _storeRefreshToken(user, refreshToken, clientIp = 'Unknown', device = 'Unknown') {
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        if (!user.refreshTokens) {
            user.refreshTokens = [];
        }
        if (user.refreshTokens.length > 20) {
            user.refreshTokens = user.refreshTokens.slice(-19);
        }

        user.refreshTokens.push({
            tokenHash,
            expiresAt,
            createdAt: new Date(),
            revokedAt: null,
            device,
            ipAddress: clientIp,
        });

        await user.save();
        return tokenHash;
    }

    // Helper: Basic TOTP verification (strictly validates HMAC token against 30s window using Base32 key)
    _verifyTOTP(secret, code) {
        if (!code || typeof code !== 'string') return false;

        try {
            const keyBuffer = base32ToBuffer(secret);
            const key = keyBuffer.length > 0 ? keyBuffer : Buffer.from(secret, 'utf-8');
            const timeStep = Math.floor(Date.now() / 30000);
            for (let i = -1; i <= 1; i++) {
                const msg = Buffer.alloc(8);
                msg.writeBigInt64BE(BigInt(timeStep + i));
                
                const hmac = crypto.createHmac('sha1', key);
                hmac.update(msg);
                const digest = hmac.digest();
                
                const offset = digest[digest.length - 1] & 0xf;
                const binary = ((digest[offset] & 0x7f) << 24) |
                               ((digest[offset + 1] & 0xff) << 16) |
                               ((digest[offset + 2] & 0xff) << 8) |
                               (digest[offset + 3] & 0xff);
                
                const otp = (binary % 1000000).toString().padStart(6, '0');
                if (otp === code) {
                    return true;
                }
            }
        } catch (err) {
            logger.warn('TOTP check math failed', { error: err.message });
        }
        return false;
    }

    // Get user by ID
    async getUser(userId) {
        try {
            const user = await this.userRepository.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }
            return user;
        } catch (error) {
            logger.error('Error in getUser', { userId, error: error.message });
            throw error;
        }
    }

    // List users with pagination
    async listUsers(options = {}) {
        try {
            return await this.userRepository.findAll(options);
        } catch (error) {
            logger.error('Error in listUsers', { error: error.message });
            throw error;
        }
    }

    // Update user preferences & detail profile
    async updateUser(userId, updateData) {
        try {
            if (updateData.email) {
                const exists = await this.userRepository.emailExists(updateData.email, userId);
                if (exists) {
                    throw new Error('Email already in use');
                }
            }

            const user = await this.userRepository.update(userId, updateData);
            if (!user) {
                throw new Error('User not found');
            }

            logger.info('User updated successfully', { userId });
            return user;
        } catch (error) {
            logger.error('Error in updateUser', { userId, error: error.message });
            throw error;
        }
    }

    // Soft delete - sets isActive = false
    async deleteUser(userId) {
        try {
            const user = await this.userRepository.delete(userId);
            if (!user) {
                throw new Error('User not found');
            }
            logger.info('User deleted successfully', { userId });
            return user;
        } catch (error) {
            logger.error('Error in deleteUser', { userId, error: error.message });
            throw error;
        }
    }

    // Hard delete (GDPR)
    async hardDeleteUser(userId) {
        try {
            const success = await this.userRepository.hardDelete(userId);
            if (!success) {
                throw new Error('User not found');
            }
            logger.warn('User hard deleted', { userId });
            return success;
        } catch (error) {
            logger.error('Error in hardDeleteUser', { userId, error: error.message });
            throw error;
        }
    }

    // Login user with email, password, and optional MFA code
    async loginUser(email, password, mfaCode = null, clientIp = '127.0.0.1', device = 'Unknown') {
        try {
            const user = await this.userRepository.findByEmailWithPassword(email);
            if (!user) {
                throw new Error('Invalid credentials');
            }

            // Check if account is temporarily locked due to excessive failed attempts
            if (typeof user.isLocked === 'function' && user.isLocked()) {
                throw new Error('Account is temporarily locked due to excessive failed attempts. Try again in 15 minutes.');
            }

            if (!user.isActive) {
                throw new Error('Account is inactive');
            }

            // Compare password
            const isPasswordValid = await user.comparePassword(password);
            if (!isPasswordValid) {
                if (typeof user.incrementLoginAttempts === 'function') {
                    await user.incrementLoginAttempts();
                }
                throw new Error('Invalid credentials');
            }

            // Check if 2FA is required
            if (user.isTwoFactorEnabled) {
                if (!mfaCode) {
                    return { mfaRequired: true, userId: user._id };
                }

                // Check backup codes first
                const backupIndex = user.twoFactorBackupCodes.indexOf(mfaCode.toUpperCase());
                let mfaValid = false;

                if (backupIndex !== -1) {
                    mfaValid = true;
                    // Remove used backup code
                    user.twoFactorBackupCodes.splice(backupIndex, 1);
                    await user.save();
                } else {
                    // Fetch user with secret field to check TOTP
                    const userWithSecret = await this.userRepository.findByIdWithFields(user._id, ['+twoFactorSecret']);
                    mfaValid = this._verifyTOTP(userWithSecret.twoFactorSecret, mfaCode);
                }

                if (!mfaValid) {
                    if (typeof user.incrementLoginAttempts === 'function') {
                        await user.incrementLoginAttempts();
                    }
                    throw new Error('Invalid MFA code');
                }
            }

            // Reset failed login attempts on successful authentication
            if (typeof user.resetLoginAttempts === 'function') {
                await user.resetLoginAttempts();
            }

            // Login audit & logging history
            user.loginHistory.push({
                ipAddress: clientIp,
                device,
                timestamp: new Date()
            });

            // Keep login history limit at 50 to avoid oversize documents
            if (user.loginHistory.length > 50) {
                user.loginHistory.shift();
            }

            // Generate JWT access & refresh tokens
            const { accessToken, refreshToken } = this._generateTokenPair(user);

            // Store refresh token
            await this._storeRefreshToken(user, refreshToken, clientIp, device);

            // Save active session token hash for backward compatibility
            const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
            user.activeSessions.push({
                tokenHash,
                device,
                createdAt: new Date()
            });

            await user.save();
            logger.info('User logged in successfully', { userId: user._id, email });

            const userObj = user.toObject();
            delete userObj.passwordHash;
            delete userObj.twoFactorSecret;
            delete userObj.twoFactorBackupCodes;

            return {
                accessToken,
                refreshToken,
                token: accessToken, // for backward compatibility
                user: userObj,
            };
        } catch (error) {
            logger.error('Error in loginUser', { email, error: error.message });
            throw error;
        }
    }

    // Refresh token rotation - verifies old refresh token, revokes it, and issues new pair
    async rotateRefreshToken(oldRefreshToken, clientIp = 'Unknown', device = 'Unknown') {
        if (!oldRefreshToken) {
            throw new Error('Refresh token is required');
        }

        const refreshSecret = config.security.jwtRefreshSecret;
        const previousRefreshSecret = config.security.jwtRefreshSecretPrevious;
        let decoded;
        try {
            decoded = jwt.verify(oldRefreshToken, refreshSecret, { algorithms: ['HS256'] });
            if (decoded.tokenType !== 'refresh') {
                throw new Error('Invalid token type for refresh');
            }
        } catch (err) {
            if (previousRefreshSecret) {
                try {
                    decoded = jwt.verify(oldRefreshToken, previousRefreshSecret, { algorithms: ['HS256'] });
                    if (decoded.tokenType !== 'refresh') {
                        throw new Error('Invalid token type for refresh');
                    }
                } catch {
                    throw new Error('Invalid or expired refresh token');
                }
            } else {
                throw new Error('Invalid or expired refresh token');
            }
        }

        const user = await this.userRepository.findById(decoded.userId);
        if (!user || !user.isActive) {
            throw new Error('User not found or inactive');
        }

        const oldHash = crypto.createHash('sha256').update(oldRefreshToken).digest('hex');
        const tokenRecord = user.refreshTokens?.find(rt => rt.tokenHash === oldHash);

        if (!tokenRecord || tokenRecord.revokedAt) {
            // Revoked token re-used -> possible token theft! Revoke all tokens for this user.
            if (user.refreshTokens) {
                user.refreshTokens.forEach(rt => { rt.revokedAt = new Date(); });
                await user.save();
            }
            throw new Error('Invalid or revoked refresh token');
        }

        // Revoke the old refresh token
        tokenRecord.revokedAt = new Date();

        // Issue new token pair
        const { accessToken, refreshToken } = this._generateTokenPair(user);
        await this._storeRefreshToken(user, refreshToken, clientIp, device);

        const userObj = user.toObject();
        delete userObj.passwordHash;
        delete userObj.twoFactorSecret;
        delete userObj.twoFactorBackupCodes;

        return {
            accessToken,
            refreshToken,
            token: accessToken,
            user: userObj,
        };
    }

    // Revoke refresh token (e.g. on logout)
    async revokeRefreshToken(userId, refreshToken) {
        if (!userId || !refreshToken) return false;
        const user = await this.userRepository.findById(userId);
        if (!user || !user.refreshTokens) return false;

        const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const tokenRecord = user.refreshTokens.find(rt => rt.tokenHash === hash);
        if (tokenRecord) {
            tokenRecord.revokedAt = new Date();
            await user.save();
            return true;
        }
        return false;
    }

    // Revoke all refresh tokens for a user (e.g. on global session revocation or full logout)
    async revokeAllUserRefreshTokens(userId) {
        if (!userId) return false;
        const user = await this.userRepository.findById(userId);
        if (!user || !user.refreshTokens) return false;
        user.refreshTokens.forEach(rt => { rt.revokedAt = new Date(); });
        await user.save();
        return true;
    }

    // Generate magic link token and log it
    async requestMagicLink(email) {
        try {
            const user = await this.userRepository.findByEmail(email);
            if (!user) {
                throw new Error('User not found');
            }

            const magicToken = crypto.randomBytes(32).toString('hex');
            // Store token in user metadata temporarily
            user.metadata = {
                ...user.metadata,
                magicToken,
                magicTokenExpires: Date.now() + 900000 // 15 mins expiration
            };
            await user.save();

            // Safe logging without leaking plaintext magic token
            logger.info('[MAILER MOCK] Magic Login Link generated', { email });
            return true;
        } catch (error) {
            logger.error('Error in requestMagicLink', { email, error: error.message });
            throw error;
        }
    }

    // Login using magic link token
    async loginWithMagicLink(token, clientIp = '127.0.0.1', device = 'Unknown') {
        try {
            const user = await this.userRepository.findByMagicToken(token);
            if (!user || !user.metadata?.magicTokenExpires || user.metadata.magicTokenExpires < Date.now()) {
                throw new Error('Invalid or expired magic link token');
            }

            // Clear magic token
            const meta = { ...user.metadata };
            delete meta.magicToken;
            delete meta.magicTokenExpires;
            user.metadata = meta;

            // Log history
            user.loginHistory.push({
                ipAddress: clientIp,
                device,
                timestamp: new Date()
            });
            await user.save();

            const userObj = user.toObject();
            delete userObj.passwordHash;

            // Generate JWT
            const jwtToken = jwt.sign(
                {
                    userId: userObj._id,
                    email: userObj.email,
                    subscriptionTier: userObj.subscriptionTier,
                },
                config.security.jwtAccessSecret,
                { expiresIn: config.security.jwtExpiresIn }
            );

            // Save active session token hash
            const tokenHash = crypto.createHash('sha256').update(jwtToken).digest('hex');
            user.activeSessions.push({
                tokenHash,
                device,
                createdAt: new Date()
            });
            await user.save();

            return { token: jwtToken, user: userObj };
        } catch (error) {
            logger.error('Error in loginWithMagicLink', { error: error.message });
            throw error;
        }
    }

    // Get active sessions
    async getActiveSessions(userId) {
        const user = await this.getUser(userId);
        return user.activeSessions || [];
    }

    // Get login history
    async getLoginHistory(userId) {
        const user = await this.getUser(userId);
        return user.loginHistory || [];
    }

    // Revoke an active session token
    async revokeSession(userId, tokenHash) {
        try {
            const user = await this.getUser(userId);
            user.activeSessions = user.activeSessions.filter(s => s.tokenHash !== tokenHash);
            await user.save();
            logger.info('Session revoked successfully', { userId, tokenHash });
            return true;
        } catch (error) {
            logger.error('Error in revokeSession', { userId, tokenHash, error: error.message });
            throw error;
        }
    }
}

export default UserService;
