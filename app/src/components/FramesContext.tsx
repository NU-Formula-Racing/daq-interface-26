import { createContext, useContext } from 'react';
import type { FramesStore } from '../hooks/useLiveFrames.ts';

export const FramesCtx = createContext<FramesStore | null>(null);

export function useFrames(): FramesStore | null {
  return useContext(FramesCtx);
}
