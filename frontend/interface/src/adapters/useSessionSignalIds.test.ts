import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSessionSignalIds } from './useSessionSignalIds';

vi.mock('@/lib/supabaseClient', () => {
  const rpc = vi.fn();
  return { supabase: { rpc } };
});

import { supabase } from '@/lib/supabaseClient';
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe('useSessionSignalIds', () => {
  beforeEach(() => { rpc.mockReset(); });

  it('returns empty set and idle status when sessionId is null', () => {
    const { result } = renderHook(() => useSessionSignalIds(null));
    expect(result.current.ids.size).toBe(0);
    expect(result.current.status).toBe('idle');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls get_session_signal_ids and exposes the ids as a Set', async () => {
    rpc.mockResolvedValueOnce({ data: [{ signal_id: 1 }, { signal_id: 5 }], error: null });
    const { result } = renderHook(() => useSessionSignalIds('sess-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(rpc).toHaveBeenCalledWith('get_session_signal_ids', { p_session_id: 'sess-1' });
    expect([...result.current.ids].sort()).toEqual([1, 5]);
  });

  it('exposes error status when RPC fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useSessionSignalIds('sess-1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.ids.size).toBe(0);
  });
});
