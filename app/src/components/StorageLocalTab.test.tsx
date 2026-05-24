import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StorageLocalTab } from './StorageLocalTab.tsx';

const sessions = [
  { id: 'a', date: '2026-05-20', synced_at: null, total_bytes: null },
  { id: 'b', date: '2026-05-21', synced_at: '2026-05-22T00:00:00Z', total_bytes: '12345' },
];

describe('StorageLocalTab', () => {
  it('uploads selected unsynced sessions and surfaces already-synced state', async () => {
    const upload = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', uploadedBytes: 100 });
    render(<StorageLocalTab sessions={sessions} uploadSession={upload} />);
    fireEvent.click(screen.getByLabelText('select-a'));
    fireEvent.click(screen.getByRole('button', { name: /upload selected/i }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith('a'));
    expect(screen.getByText(/uploaded/i)).toBeInTheDocument();
  });

  it('shows already-synced modal when API returns 409', async () => {
    const upload = vi.fn().mockResolvedValue({
      status: 'already_synced',
      existing: { uploaded_by_machine: 'other-mac', uploaded_at: '2026-05-23T00:00:00Z' },
    });
    render(<StorageLocalTab sessions={sessions} uploadSession={upload} />);
    fireEvent.click(screen.getByLabelText('select-a'));
    fireEvent.click(screen.getByRole('button', { name: /upload selected/i }));
    await waitFor(() => expect(screen.getByText(/already synced/i)).toBeInTheDocument());
    expect(screen.getByText('other-mac')).toBeInTheDocument();
  });
});
