import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSupabaseFrames } from './useSupabaseFrames';

vi.mock('@/lib/supabaseClient', () => {
  const rpc = vi.fn();
  return { supabase: { rpc } };
});

import { supabase } from '@/lib/supabaseClient';
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

const baseArgs = {
  sessionId: 'sess-1',
  start: '2026-05-01T00:00:00Z',
  end:   '2026-05-01T00:10:00Z',
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [], error: null });
});

describe('useSupabaseFrames', () => {
  it('does not refetch a signal already fetched for the same window+bucket', async () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: number[] }) => useSupabaseFrames({ ...baseArgs, signalIds: ids }),
      { initialProps: { ids: [1] } },
    );
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    expect(rpc).toHaveBeenCalledTimes(1);

    rerender({ ids: [] });
    rerender({ ids: [1] });
    await new Promise((r) => setTimeout(r, 20));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('only fetches newly added signals', async () => {
    const { rerender } = renderHook(
      ({ ids }: { ids: number[] }) => useSupabaseFrames({ ...baseArgs, signalIds: ids }),
      { initialProps: { ids: [1] } },
    );
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    rerender({ ids: [1, 2, 3] });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    const secondCall = rpc.mock.calls[1];
    expect(secondCall[0]).toBe('get_signals_window');
    expect(new Set(secondCall[1].p_signal_ids)).toEqual(new Set([2, 3]));
  });

  it('resets when sessionId changes', async () => {
    const { rerender } = renderHook(
      ({ sid }: { sid: string }) => useSupabaseFrames({ ...baseArgs, sessionId: sid, signalIds: [1] }),
      { initialProps: { sid: 'sess-1' } },
    );
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    rerender({ sid: 'sess-2' });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    const secondCall = rpc.mock.calls[1];
    expect(secondCall[1].p_session_id).toBe('sess-2');
  });
});
