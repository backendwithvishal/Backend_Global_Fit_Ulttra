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

    // GET /users — List all users with optional pagination and filtering
    router.get('/', validateRequest(listUsersSchema), (req, res, next) => controller.listUsers(req, res, next));

    // GET /users/:id — Get a single user by their MongoDB ObjectID
    router.get('/:id', validateRequest(getUserSchema), (req, res, next) => controller.getUser(req, res, next));

    // POST /users — Create a new user account
    // Additional auth rate limiter (5/15min) to prevent mass account creation
    router.post('/', authRateLimiter, validateRequest(createUserSchema), (req, res, next) => controller.createUser(req, res, next));

    // POST /users/login — Login with email and password
    // Auth rate limiter (5/15min) to prevent brute force attacks
    router.post('/login', authRateLimiter, validateRequest(loginSchema), (req, res, next) => controller.loginUser(req, res, next));

    // PUT /users/:id — Full update of user (all fields required)
    router.put('/:id', validateRequest(updateUserSchema), (req, res, next) => controller.updateUser(req, res, next));

    // PATCH /users/:id — Partial update of user (only changed fields)
    router.patch('/:id', validateRequest(patchUserSchema), (req, res, next) => controller.patchUser(req, res, next));

    // DELETE /users/:id — Soft-delete user (sets isActive = false)
    router.delete('/:id', validateRequest(deleteUserSchema), (req, res, next) => controller.deleteUser(req, res, next));

    return router;
};

export default createUserRoutes;
