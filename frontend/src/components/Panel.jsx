export default function Panel({ title, subtitle, right, children, className = '' }) {
  return (
    <section
      className={`rounded-xl border border-shroom-border bg-shroom-surface p-4 shadow-sm sm:p-5 ${className}`}
    >
      {(title || right) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}
