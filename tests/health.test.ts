import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

function buildTestApp() {
  const config = loadConfig({ NODE_ENV: 'test' });
  const logger = createLogger(config);
  return createApp(logger);
}

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(buildTestApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('unknown routes return 404', async () => {
    const res = await request(buildTestApp()).get('/nope');
    expect(res.status).toBe(404);
  });
});
