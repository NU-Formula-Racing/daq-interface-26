import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UploadAllButton } from './UploadAllButton.tsx';

describe('UploadAllButton', () => {
  it('confirms, then sequentially uploads every session, surfacing progress', async () => {
    const getSummary = vi.fn().mockResolvedValue({
      count: 2, approxBytes: 5_000_000, sessionIds: ['a', 'b'],
    });
    const upload = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', uploadedBytes: 100 })
      .mockResolvedValueOnce({ status: 'ok', uploadedBytes: 200 });
    const onChanged = vi.fn();

    render(<UploadAllButton
      getSummary={getSummary} uploadSession={upload} onChanged={onChanged} writeReady={true} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /upload all/i }))
      .toHaveTextContent('2 sessions'));

    fireEvent.click(screen.getByRole('button', { name: /upload all/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload).toHaveBeenNthCalledWith(1, 'a');
    expect(upload).toHaveBeenNthCalledWith(2, 'b');
    expect(onChanged).toHaveBeenCalled();
  });

  it('hides itself when count is zero', async () => {
    const getSummary = vi.fn().mockResolvedValue({
      count: 0, approxBytes: 0, sessionIds: [],
    });
    render(<UploadAllButton getSummary={getSummary}
      uploadSession={vi.fn()} onChanged={vi.fn()} writeReady={true} />);
    await waitFor(() => expect(getSummary).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /upload all/i })).toBeNull();
  });

  it('renders nothing when writeReady is false', async () => {
    const getSummary = vi.fn().mockResolvedValue({
      count: 5, approxBytes: 100, sessionIds: ['a', 'b', 'c', 'd', 'e'],
    });
    render(<UploadAllButton getSummary={getSummary}
      uploadSession={vi.fn()} onChanged={vi.fn()} writeReady={false} />);
    await waitFor(() => expect(getSummary).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /upload all/i })).toBeNull();
  });
});
