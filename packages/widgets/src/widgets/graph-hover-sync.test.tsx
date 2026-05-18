import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HoverProvider, FramesContext, SignalsContext } from '../data/contexts.tsx';
import { GraphWidget } from './widgets.tsx';
import type { FramesStore, SignalCatalog } from '../data/types.ts';
import type { Signal } from '../signals/catalog.ts';

// jsdom doesn't implement ResizeObserver; GraphWidget uses it for sizing.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? ResizeObserverStub;

const SIG: Signal = {
  id: 1, name: 'TestSignal', unit: 'V', color: '#0f0',
  min: 0, max: 10,
} as Signal;

const catalog: SignalCatalog = {
  list: () => [SIG],
  resolve: (key: any) => (key === 'TestSignal' || key === 1 ? SIG : null),
} as unknown as SignalCatalog;

function makeStore(): FramesStore {
  const rows = Array.from({ length: 11 }, (_, i) => ({
    ts: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    signal_id: 1,
    value: i,
  }));
  return {
    push: () => {},
    latest: () => rows[rows.length - 1],
    series: () => rows,
    firstTs: () => rows[0].ts,
    latestTs: () => rows[rows.length - 1].ts,
    getVersion: () => 0,
    subscribe: () => () => {},
  } as unknown as FramesStore;
}

function harness() {
  const store = makeStore();
  return render(
    <SignalsContext.Provider value={catalog}>
      <FramesContext.Provider value={store}>
        <HoverProvider>
          <div data-testid="a" style={{ width: 400, height: 200 }}>
            <GraphWidget signals={['TestSignal']} t={1} mode="replay" />
          </div>
          <div data-testid="b" style={{ width: 400, height: 200 }}>
            <GraphWidget signals={['TestSignal']} t={1} mode="replay" />
          </div>
        </HoverProvider>
      </FramesContext.Provider>
    </SignalsContext.Provider>,
  );
}

describe('GraphWidget hover sync', () => {
  it('hovering on one graph keeps both cursors rendered (sync)', () => {
    harness();
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(2);

    // Replay mode with t=1: each graph shows the playhead at the right edge.
    const baseline = screen.queryAllByTestId('graph-cursor').length;
    expect(baseline).toBe(2);

    fireEvent.pointerMove(svgs[0], { clientX: 200, clientY: 100 });
    // Both graphs should still render a cursor — and now the hovered fraction
    // is broadcast to both via HoverProvider, so count stays at 2.
    expect(screen.queryAllByTestId('graph-cursor').length).toBe(2);

    fireEvent.pointerLeave(svgs[0]);
    // Hover cleared; playhead at t=1 still visible on both.
    expect(screen.queryAllByTestId('graph-cursor').length).toBe(2);
  });
});
