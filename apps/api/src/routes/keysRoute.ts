import type { IncomingMessage, ServerResponse } from 'node:http';
import { listProviders, removeApiKey, resolveApiKey, saveApiKey } from '@nexus/model-gateway';
import type { ApiKeyState } from '../config/config.js';
import { readJson, sendError, sendJson } from '../shared/http.js';

function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '****';
}

export function listApiKeyStates(): ApiKeyState[] {
  return listProviders()
    .filter((provider) => !provider.isLocal)
    .map((provider) => {
      const key = resolveApiKey(provider.id);
      const fromEnv = provider.apiKeyEnvVar ? Boolean(process.env[provider.apiKeyEnvVar]) : false;
      return {
        providerId: provider.id,
        envVar: provider.apiKeyEnvVar,
        configured: Boolean(key),
        source: key ? (fromEnv ? 'env' : 'config') : null,
        masked: key ? maskKey(key) : null,
      };
    });
}

export async function handleKeysRoute(
  req: IncomingMessage,
  res: ServerResponse,
  segments: string[],
  pathname: string,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/keys') {
    sendJson(res, 200, { keys: listApiKeyStates() });
    return true;
  }
  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'keys' && segments[2]) {
    const body = await readJson<{ apiKey?: string }>(req);
    const apiKey = body.apiKey?.trim();
    if (!apiKey) {
      sendError(res, 400, 'API key is required');
      return true;
    }
    saveApiKey(segments[2], apiKey);
    sendJson(res, 200, { ok: true, keys: listApiKeyStates() });
    return true;
  }
  if (req.method === 'DELETE' && segments[0] === 'api' && segments[1] === 'keys' && segments[2]) {
    removeApiKey(segments[2]);
    sendJson(res, 200, { ok: true, keys: listApiKeyStates() });
    return true;
  }
  return false;
}
