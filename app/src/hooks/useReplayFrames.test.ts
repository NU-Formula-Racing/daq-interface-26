import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useReplayFrames } from './useReplayFrames';

vi.mock('../api/client.ts', () => ({ apiGet: vi.fn() }));

import { apiGet } from '../api/client.ts';
const mApi = apiGet as unknown as ReturnType<typeof vi.fn>;

const baseArgs = {
  sessionId: 'sess-1',
  start: '2026-05-01T00:00:00Z',
  end:   '2026-05-01T00:10:00Z',
};

beforeEach(() => {
  mApi.mockReset();
  mApi.mockResolvedValue([]);
});

describe('useReplayFrames', () => {
  it('does not refetch on toggle off-then-on for the same window', async () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: number[] }) => useReplayFrames({ ...baseArgs, signalIds: ids }),
      { initialProps: { ids: [1] } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mApi).toHaveBeenCalledTimes(1);

    rerender({ ids: [] });
    rerender({ ids: [1] });
    await new Promise((r) => setTimeout(r, 20));
    expect(mApi).toHaveBeenCalledTimes(1);
  });

  it('only fetches newly added IDs', async () => {
    const { rerender } = renderHook(
      ({ ids }: { ids: number[] }) => useReplayFrames({ ...baseArgs, signalIds: ids }),
      { initialProps: { ids: [1] } },
    );
    await waitFor(() => expect(mApi).toHaveBeenCalledTimes(1));
    rerender({ ids: [1, 2, 3] });
    await waitFor(() => expect(mApi).toHaveBeenCalledTimes(2));
    const url = mApi.mock.calls[1][0] as string;
    expect(url).toContain('ids=2,3');
  });

  it('resets when sessionId changes', async () => {
    const { rerender } = renderHook(
      ({ sid }: { sid: string }) => useReplayFrames({ ...baseArgs, sessionId: sid, signalIds: [1] }),
      { initialProps: { sid: 'sess-1' } },
    );
    await waitFor(() => expect(mApi).toHaveBeenCalledTimes(1));
    rerender({ sid: 'sess-2' });
    await waitFor(() => expect(mApi).toHaveBeenCalledTimes(2));
    expect((mApi.mock.calls[1][0] as string)).toContain('/api/sessions/sess-2/signals/window');
  });

  it('store rows carry vMin/vMax', async () => {
    mApi.mockResolvedValueOnce([
      { ts: '2026-05-01T00:00:01Z', signal_id: 1, signal_name: 'X', unit: null,
        value_min: 1, value_max: 9, value_avg: 5, sample_n: 10 },
    ]);
    const { result } = renderHook(() => useReplayFrames({ ...baseArgs, signalIds: [1] }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const series = result.current.store.series(1);
    expect(series).toHaveLength(1);
    expect(series[0].value).toBe(5);
    expect(series[0].vMin).toBe(1);
    expect(series[0].vMax).toBe(9);
  });
});
