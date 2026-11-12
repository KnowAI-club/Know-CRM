import type { Router } from 'express';
import { router as auth } from './auth/routes.js';
import { router as workspace } from './workspace/routes.js';
import { router as contacts } from './contacts/routes.js';
import { router as projectStages } from './projects/stages.js';
import { router as projects } from './projects/routes.js';
import { router as projectWork } from './projects/work.js';
import { router as tasks } from './tasks/routes.js';
import { router as files } from './files/routes.js';
import { router as invoices } from './invoices/routes.js';
import { router as leadStages } from './leads/stages.js';
import { router as leads } from './leads/routes.js';

/** Routers reachable without a session (they enforce their own access rules). */
export const publicRouters: Router[] = [auth];

/** Routers mounted behind requireAuth. */
export const privateRouters: Router[] = [workspace, contacts, projectStages, projects, projectWork, tasks, files, invoices, leadStages, leads];
