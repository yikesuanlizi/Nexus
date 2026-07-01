import { describe, expect, it } from 'vitest';
import { corsHeadersForOrigin, resolveCorsOptions } from './cors.js';

describe('CORS', () => {
  it('allows configured origins and exposes authorization headers', () => {
    const options = resolveCorsOptions({
      NEXUS_CORS_ORIGINS: 'http://localhost:5177,https://nexus.example.com',
    }, true);

    expect(corsHeadersForOrigin('https://nexus.example.com', options)).toMatchObject({
      'Access-Control-Allow-Origin': 'https://nexus.example.com',
      'Access-Control-Allow-Headers': expect.stringContaining('Authorization'),
      'Access-Control-Allow-Methods': expect.stringContaining('PATCH'),
      Vary: 'Origin',
    });
  });

  it('does not use wildcard origins when auth is enabled', () => {
    const options = resolveCorsOptions({}, true);
    expect(corsHeadersForOrigin('http://evil.example', options)).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('keeps permissive local behavior when auth is disabled', () => {
    const options = resolveCorsOptions({}, false);
    expect(corsHeadersForOrigin('http://anything.local', options)).toMatchObject({
      'Access-Control-Allow-Origin': '*',
    });
  });
});
