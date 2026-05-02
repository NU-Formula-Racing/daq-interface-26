import { describe, it, expect } from 'vitest';
import { decideDropAction } from './dropAction.ts';

describe('decideDropAction', () => {
  it('returns choose-type when there is no target widget', () => {
    expect(decideDropAction(null, 'BMS_SOC')).toEqual({
      kind: 'chooseType',
      signalId: 'BMS_SOC',
    });
  });

  it('appends signal to a graph widget without duplicating', () => {
    const w = { id: 'w1', type: 'graph', signals: ['A'] } as const;
    expect(decideDropAction(w, 'B')).toEqual({
      kind: 'patch',
      widgetId: 'w1',
      next: { ...w, signals: ['A', 'B'] },
    });
    expect(decideDropAction(w, 'A')).toEqual({
      kind: 'patch',
      widgetId: 'w1',
      next: w,
    });
  });

  it('replaces the signal on numeric and gauge widgets', () => {
    const w = { id: 'w1', type: 'numeric', signals: ['A'] } as const;
    expect(decideDropAction(w, 'B')).toEqual({
      kind: 'patch',
      widgetId: 'w1',
      next: { ...w, signals: ['B'] },
    });
  });

  it('is a no-op when dropping on a g-g widget', () => {
    const w = { id: 'w1', type: 'gg', signals: [] } as const;
    expect(decideDropAction(w, 'X_Axis_Acceleration_Uncompensated')).toEqual({
      kind: 'noop',
    });
  });

  it('treats bar and heatmap as multi-signal like graph', () => {
    for (const type of ['bar', 'heatmap'] as const) {
      const w = { id: 'w1', type, signals: ['A'] };
      expect(decideDropAction(w, 'B')).toEqual({
        kind: 'patch',
        widgetId: 'w1',
        next: { ...w, signals: ['A', 'B'] },
      });
    }
  });
});
