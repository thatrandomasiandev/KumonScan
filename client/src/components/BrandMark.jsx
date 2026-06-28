export default function BrandMark({ subtitle, compact = false }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div
        className={`bg-white rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
          compact ? 'w-8 h-8' : 'w-9 h-9'
        }`}
      >
        <span className="text-kumon-blue font-bold text-sm">K</span>
      </div>
      <div className="min-w-0">
        <h1
          className={`font-bold tracking-tight text-white ${
            compact ? 'text-base' : 'text-lg'
          }`}
        >
          KumonScan
        </h1>
        {subtitle && (
          <p className="text-white/60 text-xs truncate">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
