import express, { Router } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { loadSession, requireAuth } from './middleware/auth.js';
import { sameOrigin } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { publicRouters, privateRouters } from './modules/index.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(sameOrigin);
  app.use(loadSession);

  const api = Router();
  for (const r of publicRouters) api.use(r);
  // Everything registered below requires a signed-in user.
  api.use(requireAuth);
  for (const r of privateRouters) api.use(r);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
