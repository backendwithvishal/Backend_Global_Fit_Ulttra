import { Resend } from 'resend';
import { logger } from '../config/logger.js';
import { config } from '../config/environment.js';

export class EmailService {
    constructor(emailConfig = {}) {
        this.apiKey = emailConfig.apiKey || process.env.RESEND_API_KEY || '';
        this.from = emailConfig.from || process.env.EMAIL_FROM || 'Global_Fit_Ulttra <noreply@globalfit.com>';
        this.frontendUrl = (emailConfig.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
        this.apiBaseUrl = (process.env.KEEP_ALIVE_URL ? new URL(process.env.KEEP_ALIVE_URL).origin : 'http://localhost:4000') + '/api/v1';

        this.resend = this.apiKey ? new Resend(this.apiKey) : null;
    }

    async sendMail({ to, subject, text, html, cc, bcc, replyTo, reply_to, attachments, headers, tags }) {
        const isDev = config.server?.isDev || config.server?.isTest || process.env.NODE_ENV !== 'production';

        if (!this.resend && this.apiKey) {
            this.resend = new Resend(this.apiKey);
        }

        if (!this.resend) {
            if (isDev) {
                logger.info('Email dispatch (dev console fallback)', { to, subject });
                return { success: true, mode: 'console' };
            }
            throw new Error('Resend API key is not configured (RESEND_API_KEY is required in production)');
        }

        const payload = {
            from: this.from,
            to: Array.isArray(to) ? to : [to],
            subject,
        };

        if (html) payload.html = html;
        if (text) payload.text = text;
        if (cc) payload.cc = Array.isArray(cc) ? cc : [cc];
        if (bcc) payload.bcc = Array.isArray(bcc) ? bcc : [bcc];
        if (replyTo || reply_to) payload.replyTo = replyTo || reply_to;
        if (headers) payload.headers = headers;
        if (tags) payload.tags = tags;

        if (attachments && Array.isArray(attachments)) {
            payload.attachments = attachments.map((att) => {
                const item = { filename: att.filename || att.name };
                if (att.content) item.content = att.content;
                if (att.path) item.path = att.path;
                return item;
            });
        }

        try {
            const { data, error } = await this.resend.emails.send(payload);

            if (error) {
                logger.error('Failed to send email via Resend', { to, subject, error: error.message || error });
                if (!isDev) {
                    throw new Error(`Resend error: ${error.message || JSON.stringify(error)}`);
                }
                return { success: false, mode: 'resend-failed', error: error.message || error };
            }

            logger.info('Email sent successfully via Resend', { to, subject, id: data?.id });
            return { success: true, mode: 'resend', id: data?.id };
        } catch (error) {
            logger.error('Resend email dispatch error', { to, subject, error: error.message });
            if (!isDev) {
                throw error;
            }
            return { success: false, mode: 'resend-error', error: error.message };
        }
    }

    async sendEmail(options) {
        return this.sendMail(options);
    }

    async sendVerificationEmail(email, token) {
        const verificationUrl = `${this.apiBaseUrl}/auth/verify-email?token=${encodeURIComponent(token)}`;
        const subject = 'Verify your Global_Fit_Ulttra email address';
        const text = `Welcome to Global_Fit_Ulttra!\n\nPlease verify your email address by clicking the link below:\n${verificationUrl}\n\nThis link will expire in 24 hours.`;
        const html = `<p>Welcome to Global_Fit_Ulttra!</p><p>Please verify your email address by clicking the link below:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link will expire in 24 hours.</p>`;

        return this.sendMail({ to: email, subject, text, html });
    }

    async sendMagicLink(email, token) {
        const magicLinkUrl = `${this.apiBaseUrl}/auth/magic-link/callback?token=${encodeURIComponent(token)}`;
        const subject = 'Your Global_Fit_Ulttra Magic Login Link';
        const text = `Hello,\n\nYou requested a passwordless login link for Global_Fit_Ulttra.\n\nClick the link below to sign in:\n${magicLinkUrl}\n\nThis link is valid for 15 minutes and can only be used once.\nIf you did not request this, you can safely ignore this email.`;
        const html = `<p>Hello,</p><p>Click the link below to sign into your Global_Fit_Ulttra account:</p><p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p><p>This link is valid for 15 minutes and can only be used once.</p>`;

        return this.sendMail({ to: email, subject, text, html });
    }

    async sendPasswordReset(email, token) {
        const resetUrl = `${this.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
        const subject = 'Reset your Global_Fit_Ulttra password';
        const text = `Hello,\n\nWe received a request to reset your password for your Global_Fit_Ulttra account.\n\nClick the link below to set a new password:\n${resetUrl}\n\nThis link is valid for 1 hour.\nIf you did not request this, please ignore this email.`;
        const html = `<p>Hello,</p><p>Click the link below to set a new password for your account:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link is valid for 1 hour.</p>`;

        return this.sendMail({ to: email, subject, text, html });
    }

    async sendInvitationEmail(email, orgName, token) {
        const inviteUrl = `${this.frontendUrl}/invite/accept?token=${encodeURIComponent(token)}`;
        const subject = `You've been invited to join ${orgName} on Global_Fit_Ulttra`;
        const text = `Hello,\n\nYou have been invited to join the organization "${orgName}" on Global_Fit_Ulttra.\n\nAccept your invitation here:\n${inviteUrl}\n\nThis invitation expires in 7 days.`;
        const html = `<p>Hello,</p><p>You have been invited to join <strong>${orgName}</strong> on Global_Fit_Ulttra.</p><p><a href="${inviteUrl}">Accept Invitation</a></p><p>This invitation expires in 7 days.</p>`;

        return this.sendMail({ to: email, subject, text, html });
    }
}

export const emailService = new EmailService();
export default EmailService;
