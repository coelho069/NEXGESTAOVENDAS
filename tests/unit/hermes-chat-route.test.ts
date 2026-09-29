import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimitStateForTests } from '@/lib/security/rate-limit';

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient }));

import { GET, POST } from '@/app/api/hermes/chat/route';

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/hermes/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getRequest(): Request {
  return new Request('http://localhost/api/hermes/chat', { method: 'GET' });
}

function authedClient(userId = 'user-hermes-1') {
  createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
    },
  });
}

describe('Hermes chat route security', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStateForTests();
    delete process.env.XAI_API_KEY;
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      text: async () => '',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 401 without session on POST before calling the AI provider', async () => {
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    const response = await POST(postRequest({ message: 'oi' }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 without session on GET', async () => {
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    const response = await GET(getRequest());
    expect(response.status).toBe(401);
  });

  it('returns 503 when XAI_API_KEY is missing (fail-closed)', async () => {
    authedClient();

    const response = await POST(postRequest({ message: 'oi' }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'missing_api_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 429 when the per-user rate limit is exceeded', async () => {
    authedClient();
    vi.stubEnv('XAI_API_KEY', 'test-key');

    for (let i = 0; i < 20; i += 1) {
      const allowed = await POST(postRequest({ message: `msg-${i}` }));
      expect(allowed.status).not.toBe(429);
    }

    const limited = await POST(postRequest({ message: 'one-too-many' }));
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ error: 'rate_limited' });
    expect(limited.headers.get('Retry-After')).toBeTruthy();
  });
});
