import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults when optional vars are absent', () => {
    const config = loadConfig({});
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('reads provided values', () => {
    const config = loadConfig({ PORT: '8080', NODE_ENV: 'production' });
    expect(config.PORT).toBe(8080);
    expect(config.NODE_ENV).toBe('production');
  });

  it('throws a clear error on invalid values', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/Invalid environment configuration/);
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('rejects unknown NODE_ENV', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
