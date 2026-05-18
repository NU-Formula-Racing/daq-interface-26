import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { HoverProvider, useHover } from './contexts.tsx';

function Reader({ id }: { id: string }) {
  const { hoverT } = useHover();
  return <span data-testid={`reader-${id}`}>{hoverT == null ? 'null' : String(hoverT)}</span>;
}

function Setter({ value }: { value: number | null }) {
  const { setHoverT } = useHover();
  return <button data-testid="set" onClick={() => setHoverT(value)}>set</button>;
}

describe('HoverProvider', () => {
  it('shares hoverT across consumers and clears on null', () => {
    render(
      <HoverProvider>
        <Reader id="a" />
        <Reader id="b" />
        <Setter value={0.5} />
      </HoverProvider>,
    );
    expect(screen.getByTestId('reader-a').textContent).toBe('null');
    expect(screen.getByTestId('reader-b').textContent).toBe('null');

    act(() => { screen.getByTestId('set').click(); });
    expect(screen.getByTestId('reader-a').textContent).toBe('0.5');
    expect(screen.getByTestId('reader-b').textContent).toBe('0.5');
  });

  it('useHover outside provider returns a no-op default', () => {
    render(<Reader id="solo" />);
    expect(screen.getByTestId('reader-solo').textContent).toBe('null');
  });
});
