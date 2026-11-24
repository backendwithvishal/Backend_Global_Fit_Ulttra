import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config, connectDatabase, closeDatabaseConnection } from '../config/index.js';
import { User } from '../models/User.js';

if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.error('seed:admin is disabled in production environments.');
    process.exit(1);
}

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL || 'admin@globalfit.com';
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD || crypto.randomBytes(16).toString('hex');
const ADMIN_FIRST_NAME = 'Platform';
const ADMIN_LAST_NAME = 'Administrator';

async function seedAdmin() {
    /* eslint-disable no-console */
    console.log('='.repeat(60));
    console.log('Global_Fit_Ulttra - Admin User Seeder');
    console.log('='.repeat(60));

    try {
        await connectDatabase();

        let user = await User.findOne({ email: ADMIN_EMAIL });
        const saltRounds = config.security?.bcryptRounds || 12;
        const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, saltRounds);

        if (!user) {
            console.log(`Creating new Admin user: ${ADMIN_EMAIL}...`);
            user = new User({
                email: ADMIN_EMAIL,
                passwordHash,
                firstName: ADMIN_FIRST_NAME,
                lastName: ADMIN_LAST_NAME,
                role: 'Admin',
                isEmailVerified: true,
                isActive: true,
                preferences: {
                    theme: 'dark',
                    defaultCurrency: 'USD',
                },
            });
            await user.save();
            console.log('Admin user created successfully.');
        } else {
            console.log(`Updating existing user ${ADMIN_EMAIL} to Admin role...`);
            user.role = 'Admin';
            user.passwordHash = passwordHash;
            user.isActive = true;
            user.isEmailVerified = true;
            await user.save();
            console.log('Existing user updated to Admin.');
        }

        const payload = {
            userId: user._id.toString(),
            id: user._id.toString(),
            email: user.email,
            role: 'Admin',
            organizationId: user.organizationId ? user.organizationId.toString() : null,
            subscriptionTier: 'Enterprise',
        };

        const accessSecret = config.security.jwtAccessSecret;
        const accessToken = jwt.sign(payload, accessSecret, {
            expiresIn: '15m',
        });

        console.log('='.repeat(60));
        console.log('ADMIN CREDENTIALS & TOKEN:');
        console.log(`   Email:        ${ADMIN_EMAIL}`);
        console.log(`   Password:     ${ADMIN_PASSWORD}`);
        console.log('   Role:         Admin');
        console.log(`   User ID:      ${user._id}`);
        console.log('-'.repeat(60));
        console.log('JWT BEARER TOKEN (valid for 15 minutes):');
        console.log(accessToken);
        console.log('-'.repeat(60));
        console.log('Use this header for Admin-protected endpoints (ingest, delete, reindex):');
        console.log(`Authorization: Bearer ${accessToken}`);
        console.log('='.repeat(60));

        await closeDatabaseConnection();
        process.exit(0);
    } catch (error) {
        console.error('Failed to seed admin user:', error);
        try {
            await closeDatabaseConnection();
        } catch (closeErr) {
            console.error('Failed to close database connection cleanly:', closeErr);
        }
        process.exit(1);
    }
    /* eslint-enable no-console */
}

seedAdmin();
