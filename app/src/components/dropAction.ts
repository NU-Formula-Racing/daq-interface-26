type Widget = {
  id: string;
  type: string;
  signals: readonly any[];
};

export type DropAction =
  | { kind: 'chooseType'; signalId: any }
  | { kind: 'patch'; widgetId: string; next: Widget }
  | { kind: 'noop' };

const MULTI = new Set(['graph', 'bar', 'heatmap']);
const SINGLE = new Set(['numeric', 'gauge']);

export function decideDropAction(widget: Widget | null, signalId: any): DropAction {
  if (widget === null) return { kind: 'chooseType', signalId };
  if (widget.type === 'gg') return { kind: 'noop' };
  if (MULTI.has(widget.type)) {
    if (widget.signals.includes(signalId)) {
      return { kind: 'patch', widgetId: widget.id, next: widget };
    }
    return {
      kind: 'patch',
      widgetId: widget.id,
      next: { ...widget, signals: [...widget.signals, signalId] },
    };
  }
  if (SINGLE.has(widget.type)) {
    return {
      kind: 'patch',
      widgetId: widget.id,
      next: { ...widget, signals: [signalId] },
    };
  }
  return { kind: 'noop' };
}
