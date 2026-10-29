/**
 * Global_Fit_Ulttra - Alert Routes
 * 
 * Express router for price alert management endpoints.
 * 
 * Route Map:
 * ──────────────────────────────────────────────────────────────────────────
 * | Method | Path                 | Handler          | Description         |
 * |--------|----------------------|------------------|---------------------|
 * | GET    | /                    | listAlerts       | List alerts (paged) |
 * | GET    | /:id                 | getAlert         | Get alert by ID     |
 * | POST   | /                    | createAlert      | Create new alert    |
 * | PUT    | /:id                 | updateAlert      | Update alert        |
 * | DELETE | /:id                 | deleteAlert      | Delete alert        |
 * | PATCH  | /:id/activate        | activateAlert    | Enable alert        |
 * | PATCH  | /:id/deactivate      | deactivateAlert  | Disable alert       |
 * ──────────────────────────────────────────────────────────────────────────
 * 
 * Rate Limiting: authenticatedUserRateLimiter (1000 req / 15 min per user/IP)
 * Validation: Zod schemas from validators/alertSchemas.js
 * 
 * @module routes/alertRoutes
 */

import { Router } from 'express';
import { authenticatedUserRateLimiter } from '../middleware/index.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
    createAlertSchema,
    updateAlertSchema,
    getAlertSchema,
    deleteAlertSchema,
    listAlertsSchema,
    toggleAlertSchema,
} from '../validators/alertSchemas.js';

/**
 * Create and configure the alert routes router.
 * 
 * @param {import('../controllers/AlertController.js').AlertController} controller - Injected alert controller
 * @returns {import('express').Router} Configured Express router
 */
export const createAlertRoutes = (controller) => {
    const router = Router();

    // Apply authenticated-user rate limiter to all alert routes (1000 req / 15 min)
    router.use(authenticatedUserRateLimiter);
    router.use(requireAuth);

    // GET /alerts — List all alerts with optional filters (userId, symbol, isActive, etc.)
    router.get('/', validateRequest(listAlertsSchema), (req, res, next) => controller.listAlerts(req, res, next));

    // GET /alerts/:id — Get a single alert by its MongoDB ObjectID
    router.get('/:id', validateRequest(getAlertSchema), (req, res, next) => controller.getAlert(req, res, next));

    // POST /alerts — Create a new price alert
    router.post('/', validateRequest(createAlertSchema), (req, res, next) => controller.createAlert(req, res, next));

    // PUT /alerts/:id — Full update of an existing alert
    router.put('/:id', validateRequest(updateAlertSchema), (req, res, next) => controller.updateAlert(req, res, next));

    // DELETE /alerts/:id — Delete an alert permanently
    router.delete('/:id', validateRequest(deleteAlertSchema), (req, res, next) => controller.deleteAlert(req, res, next));

    // PATCH /alerts/:id/activate — Enable an alert for price monitoring
    router.patch('/:id/activate', validateRequest(toggleAlertSchema), (req, res, next) => controller.activateAlert(req, res, next));

    // PATCH /alerts/:id/deactivate — Disable an alert (stop monitoring)
    router.patch('/:id/deactivate', validateRequest(toggleAlertSchema), (req, res, next) => controller.deactivateAlert(req, res, next));

    return router;
};

export default createAlertRoutes;
