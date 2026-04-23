export function Placeholder({ title }: { title: string }) {
  return (
    <div className="h-full flex items-center justify-center text-[color:var(--color-text-mute)] font-mono text-xs tracking-widest">
      {title.toUpperCase()} — coming online
    </div>
  );
}
