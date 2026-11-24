import { jest } from '@jest/globals';
import { EmailService } from '../../src/services/EmailService.js';

describe('EmailService (Resend)', () => {
    let emailService;
    let mockSend;

    beforeEach(() => {
        mockSend = jest.fn();
        emailService = new EmailService({
            apiKey: 'mock-key', // gitleaks:allow
            from: 'Test App <test@example.com>',
            frontendUrl: 'http://localhost:5173',
        });
        emailService.resend = {
            emails: {
                send: mockSend,
            },
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('initializes with provided configuration', () => {
        expect(emailService.apiKey).toBe('mock-key');
        expect(emailService.from).toBe('Test App <test@example.com>');
        expect(emailService.frontendUrl).toBe('http://localhost:5173');
    });

    test('sendMail sends email successfully via Resend', async () => {
        mockSend.mockResolvedValueOnce({
            data: { id: 'msg_resend_123' },
            error: null,
        });

        const result = await emailService.sendMail({
            to: 'user@example.com',
            subject: 'Hello from Resend',
            html: '<p>Hello</p>',
            text: 'Hello',
        });

        expect(mockSend).toHaveBeenCalledWith({
            from: 'Test App <test@example.com>',
            to: ['user@example.com'],
            subject: 'Hello from Resend',
            html: '<p>Hello</p>',
            text: 'Hello',
        });
        expect(result).toEqual({ success: true, mode: 'resend', id: 'msg_resend_123' });
    });

    test('sendMail maps attachments, cc, bcc, and replyTo correctly', async () => {
        mockSend.mockResolvedValueOnce({
            data: { id: 'msg_resend_456' },
            error: null,
        });

        await emailService.sendMail({
            to: ['user1@example.com', 'user2@example.com'],
            subject: 'Monthly Report',
            html: '<p>Report attached</p>',
            cc: 'manager@example.com',
            bcc: ['audit@example.com'],
            replyTo: 'support@example.com',
            attachments: [
                { filename: 'report.pdf', content: Buffer.from('dummy-pdf') },
            ],
        });

        expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
            from: 'Test App <test@example.com>',
            to: ['user1@example.com', 'user2@example.com'],
            cc: ['manager@example.com'],
            bcc: ['audit@example.com'],
            replyTo: 'support@example.com',
            attachments: [{ filename: 'report.pdf', content: expect.any(Buffer) }],
        }));
    });

    test('sendMail handles Resend API errors gracefully in dev mode', async () => {
        mockSend.mockResolvedValueOnce({
            data: null,
            error: { message: 'Domain not verified' },
        });

        const result = await emailService.sendMail({
            to: 'user@example.com',
            subject: 'Test Error',
            html: '<p>Test</p>',
        });

        expect(result).toEqual({
            success: false,
            mode: 'resend-failed',
            error: 'Domain not verified',
        });
    });

    test('sendVerificationEmail constructs proper verification URL and sends email', async () => {
        mockSend.mockResolvedValueOnce({
            data: { id: 'msg_verify_1' },
            error: null,
        });

        const result = await emailService.sendVerificationEmail('newuser@example.com', 'test_token_abc');

        expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
            to: ['newuser@example.com'],
            subject: 'Verify your Global_Fit_Ulttra email address',
            html: expect.stringContaining('auth/verify-email?token=test_token_abc'),
        }));
        expect(result.success).toBe(true);
    });

    test('sendMagicLink constructs single-use login link and sends email', async () => {
        mockSend.mockResolvedValueOnce({
            data: { id: 'msg_magic_1' },
            error: null,
        });

        const result = await emailService.sendMagicLink('magic@example.com', 'magic_token_xyz');

        expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
            to: ['magic@example.com'],
            subject: 'Your Global_Fit_Ulttra Magic Login Link',
            html: expect.stringContaining('auth/magic-link/callback?token=magic_token_xyz'),
        }));
        expect(result.success).toBe(true);
    });

    test('sendPasswordReset constructs reset URL and sends email', async () => {
        mockSend.mockResolvedValueOnce({
            data: { id: 'msg_reset_1' },
            error: null,
        });

        const result = await emailService.sendPasswordReset('user@example.com', 'reset_token_789');

        expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
            to: ['user@example.com'],
            subject: 'Reset your Global_Fit_Ulttra password',
            html: expect.stringContaining('reset-password?token=reset_token_789'),
        }));
        expect(result.success).toBe(true);
    });

    test('sendInvitationEmail constructs invitation URL and sends email', async () => {
        mockSend.mockResolvedValueOnce({
            data: { id: 'msg_invite_1' },
            error: null,
        });

        const result = await emailService.sendInvitationEmail('teammate@example.com', 'Acme Corp', 'invite_token_111');

        expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
            to: ['teammate@example.com'],
            subject: 'You\'ve been invited to join Acme Corp on Global_Fit_Ulttra',
            html: expect.stringContaining('invite/accept?token=invite_token_111'),
        }));
        expect(result.success).toBe(true);
    });

    test('sendMail falls back to dev console when no resend client configured', async () => {
        const unconfiguredService = new EmailService({ apiKey: '' });
        const result = await unconfiguredService.sendMail({
            to: 'local@example.com',
            subject: 'Dev Log Only',
            text: 'Hello console',
        });

        expect(result).toEqual({ success: true, mode: 'console' });
    });
});
