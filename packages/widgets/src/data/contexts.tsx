import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { FramesStore, SignalCatalog } from './types.ts';

export const FramesContext = createContext<FramesStore | null>(null);
export const SignalsContext = createContext<SignalCatalog | null>(null);

export interface HoverState {
  hoverT: number | null;
  setHoverT: (v: number | null) => void;
}

const NOOP_HOVER: HoverState = { hoverT: null, setHoverT: () => {} };
export const HoverContext = createContext<HoverState>(NOOP_HOVER);

export function useFrames(): FramesStore | null {
  return useContext(FramesContext);
}

export function useCatalog(): SignalCatalog {
  const cat = useContext(SignalsContext);
  if (!cat) throw new Error('useCatalog used outside SignalsProvider');
  return cat;
}

export function useHover(): HoverState {
  return useContext(HoverContext);
}

export function FramesProvider({
  store,
  children,
}: {
  store: FramesStore | null;
  children: ReactNode;
}) {
  return <FramesContext.Provider value={store}>{children}</FramesContext.Provider>;
}

export function SignalsProvider({
  catalog,
  children,
}: {
  catalog: SignalCatalog | null;
  children: ReactNode;
}) {
  if (!catalog) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: '"JetBrains Mono", monospace', fontSize: 11, letterSpacing: 2,
        color: '#6f7278',
      }}>
        LOADING SIGNALS…
      </div>
    );
  }
  return <SignalsContext.Provider value={catalog}>{children}</SignalsContext.Provider>;
}

export function HoverProvider({ children }: { children: ReactNode }) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const value = useMemo<HoverState>(() => ({ hoverT, setHoverT }), [hoverT]);
  return <HoverContext.Provider value={value}>{children}</HoverContext.Provider>;
}

/** Set of signal IDs that have data in the current session. When the value
 *  is `null` the consumer behaves as if no filter applies (back-compat for
 *  desktop, which has all data locally). */
export const AvailableSignalsContext = createContext<ReadonlySet<number> | null>(null);

export function useAvailableSignals(): ReadonlySet<number> | null {
  return useContext(AvailableSignalsContext);
}
