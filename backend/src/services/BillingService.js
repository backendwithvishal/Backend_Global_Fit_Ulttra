import { logger } from '../config/logger.js';

export class BillingService {
    constructor({ userRepository }) {
        this.userRepository = userRepository;
        
        // Define pricing and features details
        this.plans = {
            Free: { name: 'Free Plan', priceMonthly: 0, priceYearly: 0, limitWatchlists: 1, limitAlerts: 1, limitAiCalls: 3 },
            Starter: { name: 'Starter Plan', priceMonthly: 29, priceYearly: 290, limitWatchlists: 5, limitAlerts: 10, limitAiCalls: 50 },
            Pro: { name: 'Pro Plan', priceMonthly: 79, priceYearly: 790, limitWatchlists: 99, limitAlerts: 99, limitAiCalls: 500 },
            Enterprise: { name: 'Enterprise Plan', priceMonthly: 299, priceYearly: 2990, limitWatchlists: 999, limitAlerts: 999, limitAiCalls: 9999 }
        };

        this.coupons = {
            'GLOBALFIT30': { discountPercent: 30, valid: true },
            'GLOBALFIT20': { discountPercent: 20, valid: true },
            'GLOBALFITULTTRA': { discountPercent: 50, valid: true },
            'SAASNEW': { discountPercent: 15, valid: true },
            'INVESTORFREE': { discountPercent: 100, valid: true }
        };
    }

    async createCheckoutSession(userId, planId, billingCycle = 'monthly', couponCode = '') {
        try {
            const user = await this.userRepository.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const plan = this.plans[planId];
            if (!plan) {
                throw new Error('Invalid plan selected');
            }

            let price = billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
            let discount = 0;

            if (couponCode) {
                const coupon = this.coupons[couponCode.toUpperCase()];
                if (coupon && coupon.valid) {
                    discount = (price * coupon.discountPercent) / 100;
                    price = price - discount;
                }
            }

            // In production, instantiate Stripe here and create a Stripe Checkout Session
            // const session = await stripe.checkout.sessions.create({...})
            // Since this is a demonstration environment, we'll return a simulated sandbox payment link
            const mockSessionId = `cs_test_${Math.random().toString(36).substring(7)}`;
            const redirectUrl = `http://localhost:5173/billing?checkout_session=${mockSessionId}&plan=${planId}&cycle=${billingCycle}&price=${price}&coupon=${couponCode}`;

            logger.info('Billing checkout session generated', { userId, planId, billingCycle, price });
            return { redirectUrl, sessionId: mockSessionId };
        } catch (error) {
            logger.error('Error in createCheckoutSession', { userId, planId, error: error.message });
            throw error;
        }
    }

    async confirmPayment(userId, sessionId, planId, billingCycle) {
        try {
            const user = await this.userRepository.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const endPeriod = new Date();
            if (billingCycle === 'yearly') {
                endPeriod.setFullYear(endPeriod.getFullYear() + 1);
            } else {
                endPeriod.setMonth(endPeriod.getMonth() + 1);
            }

            const updatedUser = await this.userRepository.update(userId, {
                subscriptionTier: planId,
                subscriptionStatus: 'active',
                stripeSubscriptionId: `sub_mock_${sessionId}`,
                subscriptionPeriodEnd: endPeriod,
                stripeCustomerId: user.stripeCustomerId || `cus_mock_${Math.random().toString(36).substring(7)}`
            });

            logger.info('Subscription successfully upgraded', { userId, newTier: planId, periodEnd: endPeriod });
            return updatedUser;
        } catch (error) {
            logger.error('Error in confirmPayment', { userId, planId, error: error.message });
            throw error;
        }
    }

    async cancelSubscription(userId) {
        try {
            const user = await this.userRepository.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // In Stripe: stripe.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: true })
            const updatedUser = await this.userRepository.update(userId, {
                subscriptionStatus: 'cancelled_at_period_end'
            });

            logger.info('Subscription set to cancel at period end', { userId });
            return updatedUser;
        } catch (error) {
            logger.error('Error in cancelSubscription', { userId, error: error.message });
            throw error;
        }
    }

    async getInvoices(userId) {
        try {
            const user = await this.userRepository.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Return mock list of historic invoices based on tier
            if (user.subscriptionTier === 'Free') {
                return [];
            }

            const plan = this.plans[user.subscriptionTier];
            const invoiceDate = new Date(user.createdAt);
            invoiceDate.setMonth(invoiceDate.getMonth() + 1);

            return [
                {
                    id: `inv_${Math.random().toString(36).substring(7)}`,
                    date: invoiceDate.toISOString().split('T')[0],
                    amount: plan.priceMonthly,
                    currency: 'USD',
                    status: 'paid',
                    downloadUrl: '#'
                }
            ];
        } catch (error) {
            logger.error('Error in getInvoices', { userId, error: error.message });
            throw error;
        }
    }

    async applyCoupon(couponCode) {
        const coupon = this.coupons[couponCode.toUpperCase()];
        if (!coupon || !coupon.valid) {
            throw new Error('Invalid or expired coupon code');
        }
        return coupon;
    }
}

export default BillingService;
