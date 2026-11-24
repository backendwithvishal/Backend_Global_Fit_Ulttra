/**
 * Global_Fit_Ulttra - Email Service
 * 
 * Centralized email notification service supporting:
 * - Direct SMTP transport using native Node.js net/tls sockets
 * - Console mail logger for development & test environments
 * - Template generation for email verification, magic link, password reset, and invites
 * 
 * @module services/EmailService
 */

import net from 'net';
import tls from 'tls';
import { logger } from '../config/logger.js';
import { config } from '../config/environment.js';

export class EmailService {
    constructor(emailConfig = {}) {
        this.host = emailConfig.smtpHost || process.env.SMTP_HOST || '';
        this.port = Number(emailConfig.smtpPort || process.env.SMTP_PORT || 587);
        this.user = emailConfig.smtpUser || process.env.SMTP_USER || '';
        this.pass = emailConfig.smtpPass || process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '';
        this.secure = Boolean(emailConfig.smtpSecure ?? (process.env.SMTP_SECURE === 'true' || this.port === 465));
        this.from = emailConfig.from || process.env.EMAIL_FROM || 'noreply@globalfit.com';
        this.frontendUrl = (emailConfig.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
        this.apiBaseUrl = (process.env.KEEP_ALIVE_URL ? new URL(process.env.KEEP_ALIVE_URL).origin : 'http://localhost:4000') + '/api/v1';
    }

    /**
     * Send email via configured SMTP server or log to console in development.
     */
    async sendMail({ to, subject, text, html }) {
        const isDev = config.server.isDev || config.server.isTest || process.env.NODE_ENV !== 'production';

        // In dev or when no SMTP host configured, log prominently to console/logger
        if (isDev || !this.host) {
            console.log('\n' + '='.repeat(60));
            console.log('📧 [EMAIL DISPATCHED]');
            console.log(`   To:      ${to}`);
            console.log(`   From:    ${this.from}`);
            console.log(`   Subject: ${subject}`);
            console.log('-'.repeat(60));
            console.log('Content:\n' + (text || html));
            console.log('='.repeat(60) + '\n');
            logger.info('Email sent (dev console)', { to, subject });
            
            if (!this.host) {
                return { success: true, mode: 'console' };
            }
        }

        // If SMTP host is configured, attempt real SMTP transmission
        try {
            await this._sendSmtp({ to, subject, text, html });
            logger.info('Email sent successfully via SMTP', { to, subject });
            return { success: true, mode: 'smtp' };
        } catch (error) {
            logger.error('Failed to send email via SMTP', { to, subject, error: error.message });
            if (!isDev) {
                throw error;
            }
            return { success: false, mode: 'smtp-failed', error: error.message };
        }
    }

    /**
     * Send email verification link
     */
    async sendVerificationEmail(email, token) {
        const verificationUrl = `${this.apiBaseUrl}/auth/verify-email?token=${encodeURIComponent(token)}`;
        const subject = 'Verify your Global_Fit_Ulttra email address';
        const text = `Welcome to Global_Fit_Ulttra!\n\nPlease verify your email address by clicking the link below:\n${verificationUrl}\n\nThis link will expire in 24 hours.`;
        const html = `<p>Welcome to Global_Fit_Ulttra!</p><p>Please verify your email address by clicking the link below:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link will expire in 24 hours.</p>`;

        return this.sendMail({ to: email, subject, text, html });
    }

    /**
     * Send magic login link
     */
    async sendMagicLink(email, token) {
        const magicLinkUrl = `${this.apiBaseUrl}/auth/magic-link/callback?token=${encodeURIComponent(token)}`;
        const subject = 'Your Global_Fit_Ulttra Magic Login Link';
        const text = `Hello,\n\nYou requested a passwordless login link for Global_Fit_Ulttra.\n\nClick the link below to sign in:\n${magicLinkUrl}\n\nThis link is valid for 15 minutes and can only be used once.\nIf you did not request this, you can safely ignore this email.`;
        const html = `<p>Hello,</p><p>Click the link below to sign into your Global_Fit_Ulttra account:</p><p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p><p>This link is valid for 15 minutes and can only be used once.</p>`;

        return this.sendMail({ to: email, subject, text, html });
    }

    /**
     * Send password reset email
     */
    async sendPasswordReset(email, token) {
        const resetUrl = `${this.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
        const subject = 'Reset your Global_Fit_Ulttra password';
        const text = `Hello,\n\nWe received a request to reset your password for your Global_Fit_Ulttra account.\n\nClick the link below to set a new password:\n${resetUrl}\n\nThis link is valid for 1 hour.\nIf you did not request this, please ignore this email.`;
        const html = `<p>Hello,</p><p>Click the link below to set a new password for your account:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link is valid for 1 hour.</p>`;

        return this.sendMail({ to: email, subject, text, html });
    }

    /**
     * Send organization invitation email
     */
    async sendInvitationEmail(email, orgName, token) {
        const inviteUrl = `${this.frontendUrl}/invite/accept?token=${encodeURIComponent(token)}`;
        const subject = `You've been invited to join ${orgName} on Global_Fit_Ulttra`;
        const text = `Hello,\n\nYou have been invited to join the organization "${orgName}" on Global_Fit_Ulttra.\n\nAccept your invitation here:\n${inviteUrl}\n\nThis invitation expires in 7 days.`;
        const html = `<p>Hello,</p><p>You have been invited to join <strong>${orgName}</strong> on Global_Fit_Ulttra.</p><p><a href="${inviteUrl}">Accept Invitation</a></p><p>This invitation expires in 7 days.</p>`;

        return this.sendMail({ to: email, subject, text, html });
    }

    /**
     * Native RFC 5321 SMTP transport
     */
    _sendSmtp({ to, subject, text, html }) {
        return new Promise((resolve, reject) => {
            const socket = this.secure
                ? tls.connect({ host: this.host, port: this.port, rejectUnauthorized: false })
                : net.createConnection({ host: this.host, port: this.port });

            let stage = 0;
            const timeout = setTimeout(() => {
                socket.destroy();
                reject(new Error('SMTP connection timed out'));
            }, 10000);

            const send = (cmd) => {
                socket.write(cmd + '\r\n');
            };

            socket.on('data', (chunk) => {
                const response = chunk.toString();
                const code = parseInt(response.slice(0, 3), 10);

                if (code >= 400) {
                    clearTimeout(timeout);
                    socket.end();
                    return reject(new Error(`SMTP error ${code}: ${response.trim()}`));
                }

                if (stage === 0 && code === 220) {
                    stage = 1;
                    send(`EHLO localhost`);
                } else if (stage === 1 && code === 250) {
                    if (this.user && this.pass) {
                        stage = 2;
                        send('AUTH LOGIN');
                    } else {
                        stage = 4;
                        send(`MAIL FROM:<${this.from}>`);
                    }
                } else if (stage === 2 && code === 334) {
                    stage = 3;
                    send(Buffer.from(this.user).toString('base64'));
                } else if (stage === 3 && code === 334) {
                    stage = 4;
                    send(Buffer.from(this.pass).toString('base64'));
                } else if (stage === 4 && (code === 235 || code === 250)) {
                    stage = 5;
                    send(`MAIL FROM:<${this.from}>`);
                } else if (stage === 5 && code === 250) {
                    stage = 6;
                    send(`RCPT TO:<${to}>`);
                } else if (stage === 6 && code === 250) {
                    stage = 7;
                    send('DATA');
                } else if (stage === 7 && code === 354) {
                    stage = 8;
                    const mime = [
                        `From: ${this.from}`,
                        `To: ${to}`,
                        `Subject: ${subject}`,
                        'MIME-Version: 1.0',
                        'Content-Type: text/html; charset=UTF-8',
                        '',
                        html || text,
                        '.',
                    ].join('\r\n');
                    send(mime);
                } else if (stage === 8 && code === 250) {
                    stage = 9;
                    send('QUIT');
                    clearTimeout(timeout);
                    socket.end();
                    resolve(true);
                }
            });

            socket.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }
}

export const emailService = new EmailService();
export default EmailService;

