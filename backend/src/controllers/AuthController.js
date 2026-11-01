import jwt from 'jsonwebtoken';
import { config } from '../config/environment.js';

export class AuthController {
    constructor({ userService }) {
        this.userService = userService;
    }

    async register(req, res, next) {
        try {
            const user = await this.userService.createUser(req.body);
            res.status(201).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Registration successful. Please verify your email.',
                user,
            });
        } catch (error) {
            if (error.message === 'Email already in use') {
                return res.status(409).json({ error: error.message, requestId: req.requestId });
            }
            next(error);
        }
    }

    async login(req, res, next) {
        try {
            const { email, password, mfaCode } = req.body;
            const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'] || 'Unknown';

            const result = await this.userService.loginUser(email, password, mfaCode, clientIp, userAgent);

            if (result.mfaRequired) {
                return res.status(200).json({
                    mfaRequired: true,
                    userId: result.userId,
                    message: 'MFA code required to complete login.'
                });
            }

            const isProd = process.env.NODE_ENV === 'production';

            // Set cookies for secure access and refresh sessions
            res.cookie('token', result.accessToken, {
                httpOnly: true,
                secure: isProd,
                sameSite: 'strict',
                maxAge: 15 * 60 * 1000 // 15 minutes
            });
            res.cookie('refreshToken', result.refreshToken, {
                httpOnly: true,
                secure: isProd,
                sameSite: 'strict',
                path: '/api/v1/auth/refresh',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });

            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Login successful',
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                token: result.accessToken, // Backwards compatibility
                user: result.user
            });
        } catch (error) {
            if (error.message && error.message.includes('locked')) {
                return res.status(423).json({ error: error.message, requestId: req.requestId });
            }
            if (error.message === 'Invalid credentials' || error.message === 'Invalid MFA code') {
                return res.status(401).json({ error: error.message, requestId: req.requestId });
            }
            if (error.message === 'Account is inactive') {
                return res.status(403).json({ error: error.message, requestId: req.requestId });
            }
            next(error);
        }
    }

    async refreshToken(req, res, _next) {
        try {
            let refreshToken = req.body?.refreshToken;
            if (!refreshToken && req.headers.cookie) {
                const cookies = Object.fromEntries(
                    req.headers.cookie.split(';').map(c => c.trim().split('='))
                );
                refreshToken = cookies['refreshToken'];
            }

            if (!refreshToken) {
                return res.status(400).json({
                    error: 'Refresh token is required in request body or cookie',
                    requestId: req.requestId,
                });
            }

            const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'] || 'Unknown';

            const result = await this.userService.rotateRefreshToken(refreshToken, clientIp, userAgent);

            const isProd = process.env.NODE_ENV === 'production';
            res.cookie('token', result.accessToken, {
                httpOnly: true,
                secure: isProd,
                sameSite: 'strict',
                maxAge: 15 * 60 * 1000,
            });
            res.cookie('refreshToken', result.refreshToken, {
                httpOnly: true,
                secure: isProd,
                sameSite: 'strict',
                path: '/api/v1/auth/refresh',
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });

            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Token refreshed successfully',
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                token: result.accessToken,
                user: result.user,
            });
        } catch (error) {
            res.status(401).json({
                error: error.message || 'Invalid refresh token',
                requestId: req.requestId,
            });
        }
    }

    async logout(req, res, next) {
        try {
            let refreshToken = req.body?.refreshToken;
            if (!refreshToken && req.headers?.cookie) {
                const cookies = Object.fromEntries(
                    req.headers.cookie.split(';').map(c => {
                        const [k, v] = c.trim().split('=');
                        return [k, decodeURIComponent(v || '')];
                    })
                );
                refreshToken = cookies['refreshToken'];
            }

            let userId = req.user?.userId || req.user?.id;
            if (!userId && req.headers?.authorization) {
                try {
                    const token = req.headers.authorization.replace(/^Bearer\s+/i, '');
                    const accessSecret = config.security?.jwtAccessSecret;
                    const decoded = jwt.verify(token, accessSecret, { algorithms: ['HS256'] });
                    userId = decoded.userId || decoded.id;
                } catch {
                    // Invalid access token ignored during logout
                }
            }

            if (!userId && refreshToken) {
                try {
                    const refreshSecret = config.security?.jwtRefreshSecret;
                    const decoded = jwt.verify(refreshToken, refreshSecret, { algorithms: ['HS256'] });
                    userId = decoded.userId || decoded.id;
                } catch {
                    // Invalid refresh token ignored during logout
                }
            }

            if (userId) {
                if (refreshToken) {
                    await this.userService.revokeRefreshToken(userId, refreshToken);
                } else if (typeof this.userService.revokeAllUserRefreshTokens === 'function') {
                    await this.userService.revokeAllUserRefreshTokens(userId);
                }
            }

            res.clearCookie('token');
            res.clearCookie('refreshToken', { path: '/api/v1/auth/refresh' });
            res.clearCookie('refreshToken', { path: '/api/v1/auth' });
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Logged out successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    async verifyEmail(req, res, _next) {
        try {
            const { token } = req.query;
            if (!token) {
                return res.status(400).json({ error: 'Verification token is required', requestId: req.requestId });
            }

            await this.userService.verifyEmail(token);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Email verified successfully.'
            });
        } catch (error) {
            res.status(400).json({ error: error.message, requestId: req.requestId });
        }
    }

    async requestReset(req, res, next) {
        try {
            const { email } = req.body;
            if (!email) {
                return res.status(400).json({ error: 'Email is required', requestId: req.requestId });
            }

            await this.userService.requestPasswordReset(email);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'If the email exists, a password reset link has been generated.'
            });
        } catch (error) {
            next(error);
        }
    }

    async resetPassword(req, res, _next) {
        try {
            const { token, password } = req.body;
            if (!token || !password) {
                return res.status(400).json({ error: 'Token and new password are required', requestId: req.requestId });
            }

            await this.userService.resetPassword(token, password);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Password reset successful.'
            });
        } catch (error) {
            res.status(400).json({ error: error.message, requestId: req.requestId });
        }
    }

    async setupMfa(req, res, next) {
        try {
            const userId = req.user.userId;
            const result = await this.userService.generateMfaSecret(userId);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                ...result
            });
        } catch (error) {
            next(error);
        }
    }

    async enableMfa(req, res, _next) {
        try {
            const userId = req.user.userId;
            const { code } = req.body;
            const result = await this.userService.enableMfa(userId, code);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'MFA enabled successfully.',
                ...result
            });
        } catch (error) {
            res.status(400).json({ error: error.message, requestId: req.requestId });
        }
    }

    async disableMfa(req, res, _next) {
        try {
            const userId = req.user.userId;
            const { code } = req.body;
            await this.userService.disableMfa(userId, code);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'MFA disabled successfully.'
            });
        } catch (error) {
            res.status(400).json({ error: error.message, requestId: req.requestId });
        }
    }

    async requestMagicLink(req, res, next) {
        try {
            const { email } = req.body;
            if (!email) {
                return res.status(400).json({ error: 'Email is required', requestId: req.requestId });
            }

            await this.userService.requestMagicLink(email);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'If the email exists, a magic login link has been generated.'
            });
        } catch (error) {
            next(error);
        }
    }

    async loginWithMagicLink(req, res, _next) {
        try {
            const { token } = req.query;
            if (!token) {
                return res.status(400).json({ error: 'Token parameter is required', requestId: req.requestId });
            }

            const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'] || 'Unknown';

            const result = await this.userService.loginWithMagicLink(token, clientIp, userAgent);

            res.cookie('token', result.token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });

            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Magic login successful',
                token: result.token,
                user: result.user
            });
        } catch (error) {
            res.status(401).json({ error: error.message, requestId: req.requestId });
        }
    }

    async getSessions(req, res, next) {
        try {
            const userId = req.user.userId;
            const sessions = await this.userService.getActiveSessions(userId);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                sessions
            });
        } catch (error) {
            next(error);
        }
    }

    async getLoginHistory(req, res, next) {
        try {
            const userId = req.user.userId;
            const history = await this.userService.getLoginHistory(userId);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                history
            });
        } catch (error) {
            next(error);
        }
    }

    async revokeSession(req, res, _next) {
        try {
            const userId = req.user.userId;
            const { tokenHash } = req.params;
            await this.userService.revokeSession(userId, tokenHash);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Session revoked successfully.'
            });
        } catch (error) {
            res.status(400).json({ error: error.message, requestId: req.requestId });
        }
    }
}

export default AuthController;
