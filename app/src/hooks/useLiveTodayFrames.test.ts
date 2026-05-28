import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveTodayFrames } from './useLiveTodayFrames.ts';

vi.mock('../api/ws.ts', () => ({
  subscribeLive: vi.fn(() => ({ close: () => {} })),
}));
vi.mock('../api/client.ts', () => ({
  apiGet: vi.fn(async () => []),
}));

describe('useLiveTodayFrames', () => {
  it('exposes a FramesStore-compatible store and an ensureWindow', () => {
    const { result } = renderHook(() => useLiveTodayFrames());
    expect(typeof result.current.store.latest).toBe('function');
    expect(typeof result.current.store.subscribe).toBe('function');
    expect(typeof result.current.ensureWindow).toBe('function');
  });

  it('calls /api/live/window when ensureWindow is invoked', async () => {
    const { apiGet } = await import('../api/client.ts');
    const { result } = renderHook(() => useLiveTodayFrames());
    await act(async () => {
      await result.current.ensureWindow(
        '2026-05-28T05:00:00Z',
        '2026-05-28T06:00:00Z',
        [1, 2, 3],
      );
    });
    expect(apiGet).toHaveBeenCalled();
    const [url] = (apiGet as any).mock.calls.at(-1);
    expect(url).toMatch(/\/api\/live\/window/);
    expect(url).toMatch(/ids=1,2,3/);
  });
});
