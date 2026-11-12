// Price alerts - notify users when assets hit target prices
// Supports above/below/equals conditions

export class AlertController {
    constructor({ alertService }) {
        this.alertService = alertService;
    }

    // Helper: Check if caller is owner or admin
    async _verifyOwnership(alertId, user) {
        const alert = await this.alertService.getAlert(alertId);
        if (!alert) return { error: 'not_found' };
        const ownerId = alert.userId ? (alert.userId._id || alert.userId).toString() : null;
        const callerId = user?.userId ? user.userId.toString() : null;
        const isAdmin = (user?.role || '').toLowerCase() === 'admin';
        if (ownerId !== callerId && !isAdmin) {
            return { error: 'forbidden' };
        }
        return { alert };
    }

    // List alerts with optional filters - if userId provided, returns just that user's alerts
    async listAlerts(req, res, next) {
        try {
            const { userId, symbol, isActive, isTriggered, page, limit, sort } = req.query;
            const callerId = req.user?.userId;
            const isAdmin = (req.user?.role || '').toLowerCase() === 'admin';

            const targetUserId = userId || callerId;
            if (userId && String(userId) !== String(callerId) && !isAdmin) {
                return res.status(403).json({
                    error: { code: 'E1009', message: 'Forbidden: You cannot view alerts belonging to another user' },
                    requestId: req.requestId,
                });
            }

            // Fast path for user-specific alerts
            if (targetUserId) {
                const alerts = await this.alertService.getUserAlerts(targetUserId, {
                    isActive: isActive !== undefined ? isActive : null,
                    sort: sort || '-createdAt',
                });

                return res.status(200).json({
                    requestId: req.requestId,
                    timestamp: new Date().toISOString(),
                    alerts,
                });
            }

            // General listing with filters
            const filter = {};
            if (symbol) filter.symbol = symbol.toUpperCase();
            if (isActive !== undefined) filter.isActive = isActive;
            if (isTriggered !== undefined) filter.isTriggered = isTriggered;

            const result = await this.alertService.listAlerts({
                page: page || 1,
                limit: limit || 20,
                filter,
                sort: sort || '-createdAt',
            });

            res.status(200).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                ...result,
            });
        } catch (error) {
            next(error);
        }
    }

    // Get single alert by ID
    async getAlert(req, res, next) {
        try {
            const check = await this._verifyOwnership(req.params.id, req.user);
            if (check.error === 'not_found') {
                return res.status(404).json({
                    error: { code: 'E4001', message: 'Alert not found' },
                    requestId: req.requestId,
                });
            }
            if (check.error === 'forbidden') {
                return res.status(403).json({
                    error: { code: 'E1009', message: 'Forbidden: You do not have permission to view this alert' },
                    requestId: req.requestId,
                });
            }

            res.status(200).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                alert: check.alert,
            });
        } catch (error) {
            if (error.message === 'Alert not found') {
                return res.status(404).json({
                    error: { code: 'E4001', message: 'Alert not found' },
                    requestId: req.requestId,
                });
            }
            next(error);
        }
    }

    // Create new price alert - userId strictly from authenticated token
    async createAlert(req, res, next) {
        try {
            const payload = {
                ...req.body,
                userId: req.user.userId,
                organizationId: req.user.organizationId || null,
            };

            const alert = await this.alertService.createAlert(payload);

            res.status(201).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Alert created successfully',
                alert,
            });
        } catch (error) {
            next(error);
        }
    }

    // Update existing alert - verified ownership
    async updateAlert(req, res, next) {
        try {
            const check = await this._verifyOwnership(req.params.id, req.user);
            if (check.error === 'not_found') {
                return res.status(404).json({
                    error: { code: 'E4001', message: 'Alert not found' },
                    requestId: req.requestId,
                });
            }
            if (check.error === 'forbidden') {
                return res.status(403).json({
                    error: { code: 'E1009', message: 'Forbidden: You do not own this alert' },
                    requestId: req.requestId,
                });
            }

            delete req.body.userId;
            delete req.body.organizationId;

            const alert = await this.alertService.updateAlert(req.params.id, req.body);

            res.status(200).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Alert updated successfully',
                alert,
            });
        } catch (error) {
            if (error.message === 'Alert not found') {
                return res.status(404).json({
                    error: { code: 'E4001', message: 'Alert not found' },
                    requestId: req.requestId,
                });
            }
            next(error);
        }
    }

    // Delete alert permanently - verified ownership
    async deleteAlert(req, res, next) {
        try {
            const check = await this._verifyOwnership(req.params.id, req.user);
            if (check.error === 'not_found') {
                return res.status(404).json({
                    error: { code: 'E4001', message: 'Alert not found' },
                    requestId: req.requestId,
                });
            }
            if (check.error === 'forbidden') {
                return res.status(403).json({
                    error: { code: 'E1009', message: 'Forbidden: You do not own this alert' },
                    requestId: req.requestId,
                });
            }

            await this.alertService.deleteAlert(req.params.id);

            res.status(200).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Alert deleted successfully',
            });
        } catch (error) {
            if (error.message === 'Alert not found') {
                return res.status(404).json({
                    error: { code: 'E4001', message: 'Alert not found' },
                    requestId: req.requestId,
                });
            }
            next(error);
        }
    }

    // Turn alert on - verified ownership
    async activateAlert(req, res, next) {
        try {
            const check = await this._verifyOwnership(req.params.id, req.user);
            if (check.error === 'not_found') {
                return res.status(404).json({
                    error: { code: 'E4001', message: 'Alert not found' },
                    requestId: req.requestId,
                });
            }
            if (check.error === 'forbidden') {
                return res.status(403).json({
                    error: { code: 'E1009', message: 'Forbidden: You do not own this alert' },
                    requestId: req.requestId,
                });
            }

            const alert = await this.alertService.updateAlert(req.params.id, { isActive: true });

            res.status(200).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Alert activated successfully',
                alert,
            });
        } catch (error) {
            if (error.message === 'Alert not found') {
                return res.status(404).json({
                    error: { code: 'E4001', message: 'Alert not found' },
                    requestId: req.requestId,
                });
            }
            next(error);
        }
    }

    // Turn alert off - verified ownership
    async deactivateAlert(req, res, next) {
        try {
            const check = await this._verifyOwnership(req.params.id, req.user);
            if (check.error === 'not_found') {
                return res.status(404).json({
                    error: { code: 'E4001', message: 'Alert not found' },
                    requestId: req.requestId,
                });
            }
            if (check.error === 'forbidden') {
                return res.status(403).json({
                    error: { code: 'E1009', message: 'Forbidden: You do not own this alert' },
                    requestId: req.requestId,
                });
            }

            const alert = await this.alertService.updateAlert(req.params.id, { isActive: false });

            res.status(200).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Alert deactivated successfully',
                alert,
            });
        } catch (error) {
            if (error.message === 'Alert not found') {
                return res.status(404).json({
                    error: { code: 'E4001', message: 'Alert not found' },
                    requestId: req.requestId,
                });
            }
            next(error);
        }
    }
}

export default AlertController;