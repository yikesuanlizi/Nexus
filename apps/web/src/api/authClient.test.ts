import { describe, expect, it, vi } from 'vitest';
import { authEventSourceUrl, authHeaders, installAuthenticatedFetch, setAuthJwt } from './authClient.js';

describe('auth client', () => {
  it('adds bearer tokens to same-origin API requests', async () => {
    setAuthJwt('jwt-1');
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const baseFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response('{}', { status: 200 });
    });

    const wrapped = installAuthenticatedFetch(baseFetch);
    await wrapped('/api/threads', { headers: { 'Content-Type': 'application/json' } });

    expect(calls[0].init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer jwt-1',
    });
  });

  it('does not add bearer tokens to external requests', async () => {
    setAuthJwt('jwt-1');
    expect(authHeaders('https://example.com/api')).toEqual({});
  });

  it('adds the JWT as an EventSource query parameter', () => {
    setAuthJwt('jwt-1');
    expect(authEventSourceUrl('/api/events/thread-a')).toBe('/api/events/thread-a?access_token=jwt-1');
  });
});
