import { createContext, useContext, type ReactNode } from 'react';
import type { FramesStore, SignalCatalog } from './types.ts';

export const FramesContext = createContext<FramesStore | null>(null);
export const SignalsContext = createContext<SignalCatalog | null>(null);

export function useFrames(): FramesStore | null {
  return useContext(FramesContext);
}

export function useCatalog(): SignalCatalog {
  const cat = useContext(SignalsContext);
  if (!cat) throw new Error('useCatalog used outside SignalsProvider');
  return cat;
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
