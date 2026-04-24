import { SignalsProvider } from '../components/SignalsProvider.tsx';
import { DockDirection } from '../components/dir-dock.tsx';

export function LiveMock() {
  return (
    <SignalsProvider>
      <DockDirection
        t={0.42}
        onT={() => {}}
        mode="live"
        onMode={() => {}}
        duration={1}
        density="compact"
        graphStyle="line"
      />
    </SignalsProvider>
  );
}
