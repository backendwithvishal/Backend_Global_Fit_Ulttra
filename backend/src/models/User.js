// User model - accounts with preferences and metadata

import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSchema = new Schema({
    // Primary identifier for authentication
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },

    // Bcrypt hash - select:false prevents accidental exposure in API responses
    passwordHash: {
        type: String,
        required: false,
        select: false,
    },

    firstName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50,
    },

    lastName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50,
    },

    // Role-based access control (RBAC)
    role: {
        type: String,
        enum: ['Member', 'Admin'],
        default: 'Member',
        index: true,
    },

    // Organization tenancy
    organizationId: {
        type: Schema.Types.ObjectId,
        ref: 'Organization',
        default: null,
        index: true,
    },

    // Account lockout & brute-force protection
    failedLoginAttempts: {
        type: Number,
        default: 0,
    },
    lockUntil: {
        type: Date,
    },

    // Soft delete flag
    isActive: {
        type: Boolean,
        default: true,
        index: true,
    },

    // Email verification
    isEmailVerified: {
        type: Boolean,
        default: false,
    },
    emailVerificationToken: {
        type: String,
        select: false,
    },

    // Password reset
    passwordResetToken: {
        type: String,
        select: false,
    },
    passwordResetExpires: {
        type: Date,
        select: false,
    },

    // Multi-factor authentication (MFA)
    isTwoFactorEnabled: {
        type: Boolean,
        default: false,
    },
    twoFactorSecret: {
        type: String,
        select: false,
    },
    twoFactorBackupCodes: {
        type: [String],
        default: [],
        select: false,
    },

    // Subscription & Billing details
    subscriptionTier: {
        type: String,
        enum: ['Free', 'Starter', 'Pro', 'Enterprise'],
        default: 'Free',
        index: true,
    },
    subscriptionStatus: {
        type: String,
        default: 'active',
    },
    stripeCustomerId: {
        type: String,
        index: true,
    },
    stripeSubscriptionId: {
        type: String,
    },
    subscriptionPeriodEnd: {
        type: Date,
    },

    // Active session tracking & login logs
    loginHistory: [{
        ipAddress: String,
        device: String,
        timestamp: {
            type: Date,
            default: Date.now,
        }
    }],
    activeSessions: [{
        tokenHash: String,
        device: String,
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    refreshTokens: [{
        tokenHash: { type: String, required: true },
        expiresAt: { type: Date, required: true },
        createdAt: { type: Date, default: Date.now },
        revokedAt: { type: Date, default: null },
        device: String,
        ipAddress: String,
    }],

    // User preferences for financial data
    preferences: {
        defaultCurrency: {
            type: String,
            default: 'USD',
            uppercase: true,
        },
        defaultStockSymbol: {
            type: String,
            default: 'IBM',
            uppercase: true,
        },
        defaultCryptoIds: {
            type: String,
            default: 'bitcoin,ethereum',
        },
        notifications: {
            email: {
                type: Boolean,
                default: true,
            },
            websocket: {
                type: Boolean,
                default: true,
            },
        },
    },

    // Extensible metadata for additional data
    metadata: {
        type: Schema.Types.Mixed,
        default: {},
    },
}, {
    timestamps: true,
    collection: 'users',
});

// Indexes for common queries
userSchema.index({ createdAt: -1 });
userSchema.index({ isActive: 1, createdAt: -1 });

// Virtual property for full name
userSchema.virtual('fullName').get(function () {
    return `${this.firstName} ${this.lastName}`;
});

// Include virtuals in JSON
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

// Helper: Check if account is locked due to excessive failed logins
userSchema.methods.isLocked = function () {
    return Boolean(this.lockUntil && this.lockUntil > Date.now());
};

// Helper: Increment failed logins and lock account if limit exceeded
userSchema.methods.incrementLoginAttempts = async function () {
    // If previous lock has expired, reset counter
    if (this.lockUntil && this.lockUntil < Date.now()) {
        return this.updateOne({
            $set: { failedLoginAttempts: 1 },
            $unset: { lockUntil: 1 },
        });
    }

    const updates = { $inc: { failedLoginAttempts: 1 } };
    // Lock after 5 failed attempts for 15 minutes
    if (this.failedLoginAttempts + 1 >= 5 && !this.isLocked()) {
        updates.$set = { lockUntil: new Date(Date.now() + 15 * 60 * 1000) };
    }
    return this.updateOne(updates);
};

// Helper: Reset login attempts on successful login
userSchema.methods.resetLoginAttempts = async function () {
    return this.updateOne({
        $set: { failedLoginAttempts: 0 },
        $unset: { lockUntil: 1 },
    });
};

// Method to compare password with hash
userSchema.methods.comparePassword = async function (candidatePassword) {
    if (!this.passwordHash) {
        return false;
    }

    // Import bcrypt dynamically to avoid loading it if not needed
    // import() returns the module namespace { default: bcryptLib }, so use .default
    const bcrypt = await import('bcrypt');
    return bcrypt.default.compare(candidatePassword, this.passwordHash);
};

// Static method to hash password with cost >= 12
userSchema.statics.hashPassword = async function (password) {
    // import() returns the module namespace { default: bcryptLib }, so use .default
    const bcrypt = await import('bcrypt');
    return bcrypt.default.hash(password, 12);
};

export const User = mongoose.model('User', userSchema);

export default User;
