import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SignalCatalog } from '../signals/catalog.ts';
import { buildCatalog } from '../signals/catalog.ts';
import { apiGet } from '../api/client.ts';
import type { SignalDefinition } from '../api/types.ts';

const Ctx = createContext<SignalCatalog | null>(null);

export function SignalsProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<SignalCatalog | null>(null);

  useEffect(() => {
    apiGet<SignalDefinition[]>('/api/signal-definitions')
      .then((defs) => setCatalog(buildCatalog(defs)))
      .catch((err) => {
        console.error('Failed to load signal definitions', err);
        setCatalog(buildCatalog([]));
      });
  }, []);

  if (!catalog) {
    return (
      <div className="h-full flex items-center justify-center font-mono text-xs text-[color:var(--color-text-faint)] tracking-widest">
        LOADING SIGNALS…
      </div>
    );
  }

  return <Ctx.Provider value={catalog}>{children}</Ctx.Provider>;
}

export function useCatalog(): SignalCatalog {
  const cat = useContext(Ctx);
  if (!cat) throw new Error('useCatalog used outside SignalsProvider');
  return cat;
}
