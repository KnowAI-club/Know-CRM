import type { Router } from 'express';
import { router as auth } from './auth/routes.js';

/** Routers reachable without a session (they enforce their own access rules). */
export const publicRouters: Router[] = [auth];

/** Routers mounted behind requireAuth. */
export const privateRouters: Router[] = [];
