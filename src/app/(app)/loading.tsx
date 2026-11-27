/** Shown instantly while a page loads, so a menu click never looks dead. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="bg-brand-gradient fixed left-0 right-0 top-0 z-50 h-0.5 animate-pulse" />
      <div className="h-7 w-48 animate-pulse rounded-md bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-2" />)}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
    </div>
  );
}
