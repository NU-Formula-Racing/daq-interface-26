import { useEffect, useState } from 'react';
import type { SignalCatalog, SignalDefinition } from '@nfr/widgets';
import { buildCatalog } from '@nfr/widgets';
import { supabase } from '@/lib/supabaseClient';
import { fetchAllRows } from '@/lib/paginatedFetch';

export function useSupabaseCatalog(): SignalCatalog | null {
  const [catalog, setCatalog] = useState<SignalCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllRows((sb: any) =>
      sb.from('signal_definitions').select('id, source, signal_name, unit, description').order('id'),
    )
      .then((rows: SignalDefinition[]) => {
        if (cancelled) return;
        setCatalog(buildCatalog(rows));
      })
      .catch((err: unknown) => {
        console.error('useSupabaseCatalog: fetch failed', err);
        setCatalog(buildCatalog([]));
      });
    return () => { cancelled = true; };
  }, []);

  return catalog;
}
