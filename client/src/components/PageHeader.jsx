export default function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <span className="w-1 h-8 rounded-full bg-kumon-red shrink-0" aria-hidden="true" />
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            {title}
          </h2>
        </div>
        {subtitle && (
          <p className="text-slate-500 text-sm sm:text-base ml-4">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
