import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SessionPicker from './SessionPicker';

const SESSIONS = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001',
    date: '2026-04-21', started_at: '2026-04-21T14:23:00Z',
    ended_at: '2026-04-21T14:28:20Z', duration_secs: 320,
    driver: 'Alex', car: null, session_number: 1, source: 'sd_import' },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002',
    date: '2026-04-21', started_at: '2026-04-21T15:00:00Z',
    ended_at: '2026-04-21T15:05:00Z', duration_secs: 300,
    driver: 'Sam', car: null, session_number: 2, source: 'sd_import' },
  { id: 'bbbbbbbb-0000-0000-0000-000000000003',
    date: '2026-04-22', started_at: '2026-04-22T10:00:00Z',
    ended_at: '2026-04-22T10:02:00Z', duration_secs: 120,
    driver: null, car: null, session_number: null, source: 'live' },
];

const LIVE_SESSIONS = [
  { id: 'cccccccc-0000-0000-0000-000000000004',
    started_at: '2026-04-23T09:00:00Z', ended_at: null,
    machine: 'pit-laptop' },
];

describe('SessionPicker', () => {
  it('opens a calendar; day with 2 sd_import sessions shows the badge', () => {
    render(<SessionPicker sessions={SESSIONS} currentId={null} onPick={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /select session|▾/i }));
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(screen.getByTestId('session-count-badge')).toHaveTextContent('2');
  });

  it('drills into a day; labels do not use #N', () => {
    render(<SessionPicker sessions={SESSIONS} currentId={null} onPick={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /select session|▾/i }));
    fireEvent.click(screen.getByText('21'));
    expect(screen.queryByText(/#1/)).toBeNull();
    expect(screen.queryByText(/#2/)).toBeNull();
    expect(screen.getAllByText('aaaaaaaa').length).toBeGreaterThan(0);
  });

  it('calls onPick on session click', () => {
    const onPick = vi.fn();
    render(<SessionPicker sessions={SESSIONS} currentId={null} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /select session|▾/i }));
    fireEvent.click(screen.getByText('21'));
    fireEvent.click(screen.getAllByText('aaaaaaaa')[0]);
    expect(onPick).toHaveBeenCalledWith('aaaaaaaa-0000-0000-0000-000000000001');
  });

  it('renders a LIVE section above the calendar when liveSessions present', () => {
    const onPick = vi.fn();
    render(<SessionPicker sessions={SESSIONS} liveSessions={LIVE_SESSIONS} currentId={null} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /select session|▾/i }));
    expect(screen.getByText(/● LIVE \(last 12h\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/LIVE · /));
    expect(onPick).toHaveBeenCalledWith('cccccccc-0000-0000-0000-000000000004');
  });
});
