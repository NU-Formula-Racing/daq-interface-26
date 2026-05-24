import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StorageCloudTab } from './StorageCloudTab.tsx';

const groups = [
  { date: '2026-05-20', totalBytes: 1_500_000, sessions: [
    { id: 'a', date: '2026-05-20', totalBytes: 1_000_000, alreadyLocal: false },
    { id: 'b', date: '2026-05-20', totalBytes: 500_000,  alreadyLocal: true  },
  ]},
];

describe('StorageCloudTab', () => {
  it('shows day groups, opens warning modal, calls pullSessions on confirm', async () => {
    const pull = vi.fn().mockResolvedValue({ results: [{ id: 'a', ok: true, rowCount: 100 }] });
    render(<StorageCloudTab groups={groups} pullSessions={pull} />);
    fireEvent.click(screen.getByLabelText('select-day-2026-05-20'));
    fireEvent.click(screen.getByRole('button', { name: /pull selected/i }));
    expect(screen.getByText(/about to download/i)).toBeInTheDocument();
    expect(screen.getByText(/1\.0 MB/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await waitFor(() => expect(pull).toHaveBeenCalledWith(['a']));
  });
});
