export function SkeletonBlock({ className = '' }) {
  return (
    <div className={`bg-slate-200 rounded animate-pulse ${className}`} />
  );
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="bg-white rounded-[10px] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <SkeletonBlock className="h-4 w-1/3 mb-4" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} className={`h-3 mb-2 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

export function SkeletonKPI() {
  return (
    <div className="bg-white rounded-[10px] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] border-l-4 border-slate-200">
      <SkeletonBlock className="h-9 w-24 mb-2" />
      <SkeletonBlock className="h-3 w-20 mb-3" />
      <SkeletonBlock className="h-3 w-16" />
    </div>
  );
}
