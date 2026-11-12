/**
 * Global_Fit_Ulttra - User Routes
 * 
 * Express router for user management endpoints (CRUD operations).
 * 
 * Route Map:
 * ──────────────────────────────────────────────────────────────────
 * | Method | Path        | Handler      | Description              |
 * |--------|-------------|--------------|--------------------------|
 * | GET    | /           | listUsers    | List users (paginated)   |
 * | GET    | /:id        | getUser      | Get single user by ID    |
 * | POST   | /           | createUser   | Create new user account  |
 * | POST   | /login      | loginUser    | Login with credentials   |
 * | PUT    | /:id        | updateUser   | Full update of user      |
 * | PATCH  | /:id        | patchUser    | Partial update of user   |
 * | DELETE | /:id        | deleteUser   | Soft-delete user         |
 * ──────────────────────────────────────────────────────────────────
 * 
 * Rate Limiting: authenticatedUserRateLimiter (1000 req / 15 min per user/IP)
 * Validation: Zod schemas from validators/userSchemas.js
 * 
 * Security Notes:
 * - POST (create) also has authRateLimiter (5 req / 15 min) to prevent
 *   mass account creation / enumeration attacks.
 * - All inputs are validated and sanitized before reaching the controller.
 * - MongoDB ObjectID format is enforced on :id params.
 * 
 * @module routes/userRoutes
 */

import { Router } from 'express';
import { authenticatedUserRateLimiter, authRateLimiter } from '../middleware/index.js';
import { requireAuth, checkRole, requireSelfOrAdmin } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
    createUserSchema,
    updateUserSchema,
    patchUserSchema,
    getUserSchema,
    deleteUserSchema,
    listUsersSchema,
    loginSchema,
} from '../validators/userSchemas.js';

/**
 * Create and configure the user routes router.
 * 
 * @param {import('../controllers/UserController.js').UserController} controller - Injected user controller
 * @returns {import('express').Router} Configured Express router
 */
export const createUserRoutes = (controller) => {
    const router = Router();

    // Apply authenticated-user rate limiter to all user routes (1000 req / 15 min)
    router.use(authenticatedUserRateLimiter);

    // POST /users — Create a new user account (Public with strict limiter)
    router.post('/', authRateLimiter, validateRequest(createUserSchema), (req, res, next) => controller.createUser(req, res, next));

    // POST /users/login — Login with email and password (Public with strict limiter)
    router.post('/login', authRateLimiter, validateRequest(loginSchema), (req, res, next) => controller.loginUser(req, res, next));

    // GET /users — List all users (Admin only)
    router.get('/', requireAuth, checkRole(['Admin']), validateRequest(listUsersSchema), (req, res, next) => controller.listUsers(req, res, next));

    // GET /users/:id — Get user profile (Self or Admin)
    router.get('/:id', requireAuth, requireSelfOrAdmin('id'), validateRequest(getUserSchema), (req, res, next) => controller.getUser(req, res, next));

    // PUT /users/:id — Full update of user (Self or Admin)
    router.put('/:id', requireAuth, requireSelfOrAdmin('id'), validateRequest(updateUserSchema), (req, res, next) => controller.updateUser(req, res, next));

    // PATCH /users/:id — Partial update of user (Self or Admin)
    router.patch('/:id', requireAuth, requireSelfOrAdmin('id'), validateRequest(patchUserSchema), (req, res, next) => controller.patchUser(req, res, next));

    // DELETE /users/:id — Soft-delete user (Self or Admin)
    router.delete('/:id', requireAuth, requireSelfOrAdmin('id'), validateRequest(deleteUserSchema), (req, res, next) => controller.deleteUser(req, res, next));

    return router;
};

export default createUserRoutes;
