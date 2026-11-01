// Watchlist management - users can create named collections of assets to track

export class WatchlistController {
    constructor({ watchlistService }) {
        this.watchlistService = watchlistService;
    }

    // Helper: Check if caller is owner or admin
    async _verifyOwnership(watchlistId, user) {
        const watchlist = await this.watchlistService.getWatchlist(watchlistId);
        if (!watchlist) return { error: 'not_found' };
        const ownerId = watchlist.userId ? (watchlist.userId._id || watchlist.userId).toString() : null;
        const callerId = user?.userId ? user.userId.toString() : null;
        const isAdmin = (user?.role || '').toLowerCase() === 'admin';
        if (ownerId !== callerId && !isAdmin) {
            return { error: 'forbidden' };
        }
        return { watchlist };
    }

    // List watchlists - if userId provided, returns just that user's lists
    async listWatchlists(req, res, next) {
        try {
            const { userId, page, limit, isPublic, sort } = req.query;
            const callerId = req.user?.userId;
            const isAdmin = (req.user?.role || '').toLowerCase() === 'admin';

            // If userId requested, only self or admin can query another user's watchlists
            const targetUserId = userId || callerId;
            if (userId && String(userId) !== String(callerId) && !isAdmin) {
                return res.status(403).json({
                    error: { code: 'E1009', message: 'Forbidden: You cannot view watchlists belonging to another user' },
                    requestId: req.requestId,
                });
            }

            if (targetUserId) {
                const watchlists = await this.watchlistService.getUserWatchlists(targetUserId, {
                    sort: sort || '-createdAt',
                });

                return res.status(200).json({
                    requestId: req.requestId,
                    timestamp: new Date().toISOString(),
                    watchlists,
                });
            }

            const filter = {};
            if (isPublic !== undefined) {
                filter.isPublic = isPublic;
            }

            const result = await this.watchlistService.listWatchlists({
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

    // Get single watchlist by ID
    async getWatchlist(req, res, next) {
        try {
            const check = await this._verifyOwnership(req.params.id, req.user);
            if (check.error === 'not_found') {
                return res.status(404).json({
                    error: { code: 'E3001', message: 'Watchlist not found' },
                    requestId: req.requestId,
                });
            }
            if (check.error === 'forbidden' && !check.watchlist?.isPublic) {
                return res.status(403).json({
                    error: { code: 'E1009', message: 'Forbidden: You do not have permission to view this watchlist' },
                    requestId: req.requestId,
                });
            }

            res.status(200).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                watchlist: check.watchlist,
            });
        } catch (error) {
            if (error.message === 'Watchlist not found') {
                return res.status(404).json({
                    error: { code: 'E3001', message: 'Watchlist not found' },
                    requestId: req.requestId,
                });
            }
            next(error);
        }
    }

    // Create new watchlist - user ID derived strictly from authenticated token
    async createWatchlist(req, res, next) {
        try {
            const payload = {
                ...req.body,
                userId: req.user.userId,
                organizationId: req.user.organizationId || null,
            };

            const watchlist = await this.watchlistService.createWatchlist(payload);

            res.status(201).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Watchlist created successfully',
                watchlist,
            });
        } catch (error) {
            if (error.message === 'Watchlist name already exists for this user') {
                return res.status(409).json({
                    error: { code: 'E3002', message: 'Watchlist name already exists for this user' },
                    requestId: req.requestId,
                });
            }
            next(error);
        }
    }

    // Update watchlist metadata - verified ownership
    async updateWatchlist(req, res, next) {
        try {
            const check = await this._verifyOwnership(req.params.id, req.user);
            if (check.error === 'not_found') {
                return res.status(404).json({
                    error: { code: 'E3001', message: 'Watchlist not found' },
                    requestId: req.requestId,
                });
            }
            if (check.error === 'forbidden') {
                return res.status(403).json({
                    error: { code: 'E1009', message: 'Forbidden: You do not own this watchlist' },
                    requestId: req.requestId,
                });
            }

            // Strip client-supplied user ownership modifications
            delete req.body.userId;
            delete req.body.organizationId;

            const watchlist = await this.watchlistService.updateWatchlist(req.params.id, req.body);

            res.status(200).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Watchlist updated successfully',
                watchlist,
            });
        } catch (error) {
            if (error.message === 'Watchlist not found') {
                return res.status(404).json({
                    error: { code: 'E3001', message: 'Watchlist not found' },
                    requestId: req.requestId,
                });
            }
            next(error);
        }
    }

    // Delete watchlist permanently - verified ownership
    async deleteWatchlist(req, res, next) {
        try {
            const check = await this._verifyOwnership(req.params.id, req.user);
            if (check.error === 'not_found') {
                return res.status(404).json({
                    error: { code: 'E3001', message: 'Watchlist not found' },
                    requestId: req.requestId,
                });
            }
            if (check.error === 'forbidden') {
                return res.status(403).json({
                    error: { code: 'E1009', message: 'Forbidden: You do not own this watchlist' },
                    requestId: req.requestId,
                });
            }

            await this.watchlistService.deleteWatchlist(req.params.id);

            res.status(200).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Watchlist deleted successfully',
            });
        } catch (error) {
            if (error.message === 'Watchlist not found') {
                return res.status(404).json({
                    error: { code: 'E3001', message: 'Watchlist not found' },
                    requestId: req.requestId,
                });
            }
            next(error);
        }
    }

    // Add asset to watchlist - verified ownership
    async addAsset(req, res, next) {
        try {
            const check = await this._verifyOwnership(req.params.id, req.user);
            if (check.error === 'not_found') {
                return res.status(404).json({
                    error: { code: 'E3001', message: 'Watchlist not found' },
                    requestId: req.requestId,
                });
            }
            if (check.error === 'forbidden') {
                return res.status(403).json({
                    error: { code: 'E1009', message: 'Forbidden: You do not own this watchlist' },
                    requestId: req.requestId,
                });
            }

            const { symbol, notes } = req.body;
            const watchlist = await this.watchlistService.addAssetToWatchlist(
                req.params.id,
                symbol,
                notes
            );

            res.status(200).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Asset added to watchlist successfully',
                watchlist,
            });
        } catch (error) {
            if (error.message === 'Watchlist not found') {
                return res.status(404).json({
                    error: { code: 'E3001', message: 'Watchlist not found' },
                    requestId: req.requestId,
                });
            }
            next(error);
        }
    }

    // Remove asset from watchlist - verified ownership
    async removeAsset(req, res, next) {
        try {
            const check = await this._verifyOwnership(req.params.id, req.user);
            if (check.error === 'not_found') {
                return res.status(404).json({
                    error: { code: 'E3001', message: 'Watchlist not found' },
                    requestId: req.requestId,
                });
            }
            if (check.error === 'forbidden') {
                return res.status(403).json({
                    error: { code: 'E1009', message: 'Forbidden: You do not own this watchlist' },
                    requestId: req.requestId,
                });
            }

            const watchlist = await this.watchlistService.removeAssetFromWatchlist(
                req.params.id,
                req.params.symbol
            );

            res.status(200).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Asset removed from watchlist successfully',
                watchlist,
            });
        } catch (error) {
            if (error.message === 'Watchlist not found') {
                return res.status(404).json({
                    error: { code: 'E3001', message: 'Watchlist not found' },
                    requestId: req.requestId,
                });
            }
            next(error);
        }
    }
}

export default WatchlistController;
