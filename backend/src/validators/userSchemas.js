// User validation schemas

import { z } from 'zod';

export const createUserSchema = z.object({
    body: z.object({
        email: z.string()
            .email('Invalid email address')
            .toLowerCase()
            .trim(),
        firstName: z.string()
            .min(1, 'First name is required')
            .max(50, 'First name must be 50 characters or less')
            .trim(),
        lastName: z.string()
            .min(1, 'Last name is required')
            .max(50, 'Last name must be 50 characters or less')
            .trim(),
        password: z.string()
            .min(8, 'Password must be at least 8 characters')
            .max(128, 'Password must be 128 characters or less')
            .optional(),
        preferences: z.object({
            defaultCurrency: z.string().length(3).toUpperCase().optional(),
            defaultStockSymbol: z.string().toUpperCase().optional(),
            defaultCryptoIds: z.string().optional(),
            notifications: z.object({
                email: z.boolean().optional(),
                websocket: z.boolean().optional(),
            }).optional(),
        }).optional(),
    }),
});

export const registerSchema = z.object({
    body: z.object({
        email: z.string()
            .email('Invalid email address')
            .toLowerCase()
            .trim(),
        password: z.string()
            .min(8, 'Password must be at least 8 characters')
            .max(128, 'Password must be 128 characters or less'),
        firstName: z.string()
            .min(1, 'First name is required')
            .max(50, 'First name must be 50 characters or less')
            .trim(),
        lastName: z.string()
            .min(1, 'Last name is required')
            .max(50, 'Last name must be 50 characters or less')
            .trim(),
        preferences: z.object({
            defaultCurrency: z.string().length(3).toUpperCase().optional(),
            defaultStockSymbol: z.string().toUpperCase().optional(),
            defaultCryptoIds: z.string().optional(),
            notifications: z.object({
                email: z.boolean().optional(),
                websocket: z.boolean().optional(),
            }).optional(),
        }).optional(),
    }),
});

export const updateUserSchema = z.object({
    params: z.object({
        id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid user ID format'),
    }),
    body: z.object({
        email: z.string()
            .email('Invalid email address')
            .toLowerCase()
            .trim()
            .optional(),
        firstName: z.string()
            .min(1, 'First name is required')
            .max(50, 'First name must be 50 characters or less')
            .trim()
            .optional(),
        lastName: z.string()
            .min(1, 'Last name is required')
            .max(50, 'Last name must be 50 characters or less')
            .trim()
            .optional(),
        isActive: z.boolean().optional(),
        preferences: z.object({
            defaultCurrency: z.string().length(3).toUpperCase().optional(),
            defaultStockSymbol: z.string().toUpperCase().optional(),
            defaultCryptoIds: z.string().optional(),
            notifications: z.object({
                email: z.boolean().optional(),
                websocket: z.boolean().optional(),
            }).optional(),
        }).optional(),
    }),
});

export const patchUserSchema = updateUserSchema;

export const getUserSchema = z.object({
    params: z.object({
        id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid user ID format'),
    }),
});

export const deleteUserSchema = getUserSchema;

export const listUsersSchema = z.object({
    query: z.object({
        page: z.string().regex(/^\d+$/).transform(Number).optional(),
        limit: z.string().regex(/^\d+$/).transform(Number).optional(),
        isActive: z.enum(['true', 'false']).transform(val => val === 'true').optional(),
        sort: z.string().optional(),
    }),
});

export const loginSchema = z.object({
    body: z.object({
        email: z.string()
            .email('Invalid email address')
            .toLowerCase()
            .trim(),
        password: z.string()
            .min(1, 'Password is required'),
        mfaCode: z.string().optional(),
    }),
});

export const requestResetSchema = z.object({
    body: z.object({
        email: z.string()
            .email('Invalid email address')
            .toLowerCase()
            .trim(),
    }),
});

export const resetPasswordSchema = z.object({
    body: z.object({
        token: z.string().min(1, 'Token is required').trim(),
        password: z.string()
            .min(8, 'Password must be at least 8 characters')
            .max(128, 'Password must be 128 characters or less'),
    }),
});

export const magicLinkSchema = z.object({
    body: z.object({
        email: z.string()
            .email('Invalid email address')
            .toLowerCase()
            .trim(),
    }),
});

export default {
    createUserSchema,
    registerSchema,
    updateUserSchema,
    patchUserSchema,
    getUserSchema,
    deleteUserSchema,
    listUsersSchema,
    loginSchema,
    requestResetSchema,
    resetPasswordSchema,
    magicLinkSchema,
};
