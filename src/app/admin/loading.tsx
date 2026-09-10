export default function AdminLoading() {
  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true" aria-live="polite">
      <div className="animate-pulse space-y-3">
        <div className="h-3 w-36 rounded bg-slate-200" />
        <div className="h-9 w-64 rounded bg-slate-200" />
        <div className="h-4 w-full max-w-2xl rounded bg-slate-100" />
      </div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ))}
      </section>
      <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white" />
    </main>
  );
}
