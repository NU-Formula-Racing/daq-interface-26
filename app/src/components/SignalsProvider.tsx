import { useEffect, useState, type ReactNode } from 'react';
import { SignalsProvider as SharedSignalsProvider, buildCatalog } from '@nfr/widgets';
import type { SignalCatalog, SignalDefinition } from '@nfr/widgets';
import { apiGet } from '../api/client.ts';

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

  return <SharedSignalsProvider catalog={catalog}>{children}</SharedSignalsProvider>;
}

export { useCatalog } from '@nfr/widgets';
