import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiGet, apiPost, apiPatch, apiDelete } from './client.ts';

const originalFetch = globalThis.fetch;

describe('api client', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('apiGet encodes query params and returns parsed JSON', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'abc' }],
    });
    const rows = await apiGet<{ id: string }[]>('/api/sessions', { from: '2026-01-01' });
    expect(rows[0].id).toBe('abc');
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('/api/sessions?from=2026-01-01');
  });

  it('apiPost sends JSON body and Content-Type header', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await apiPost('/api/config', { watchDir: '/tmp' });
    const init = (globalThis.fetch as any).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as any)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"watchDir":"/tmp"}');
  });

  it('apiDelete sends DELETE and tolerates 204', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: true, status: 204, json: async () => null });
    await expect(apiDelete('/api/sessions/abc')).resolves.toBeUndefined();
  });

  it('throws on non-ok responses with status and body text', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    });
    await expect(apiGet('/api/sessions')).rejects.toThrow(/500/);
  });
});
