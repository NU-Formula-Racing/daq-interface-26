import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSessionSignalIds } from './useSessionSignalIds';

vi.mock('../api/client.ts', () => ({
  apiGet: vi.fn(),
}));

import { apiGet } from '../api/client.ts';
const mApi = apiGet as unknown as ReturnType<typeof vi.fn>;

describe('useSessionSignalIds', () => {
  beforeEach(() => { mApi.mockReset(); });

  it('returns empty set + idle when sessionId is null', () => {
    const { result } = renderHook(() => useSessionSignalIds(null));
    expect(result.current.ids.size).toBe(0);
    expect(result.current.status).toBe('idle');
    expect(mApi).not.toHaveBeenCalled();
  });

  it('fetches and exposes ids as a Set', async () => {
    mApi.mockResolvedValueOnce([1, 5, 9]);
    const { result } = renderHook(() => useSessionSignalIds('sess-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mApi).toHaveBeenCalledWith('/api/sessions/sess-1/signal-ids');
    expect([...result.current.ids].sort()).toEqual([1, 5, 9]);
  });

  it('reports error status when fetch fails', async () => {
    mApi.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useSessionSignalIds('sess-1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.ids.size).toBe(0);
  });
});
