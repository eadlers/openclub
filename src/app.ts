import express from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from './logger.js';

export function createApp(logger: Logger) {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
