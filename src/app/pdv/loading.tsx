export default function PdvLoading() {
  return (
    <main
      className="flex min-h-screen flex-col gap-4 p-4 sm:p-6"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="h-9 w-40 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-9 w-28 animate-pulse rounded-lg bg-slate-200" />
      </div>
      <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <div className="h-12 w-full animate-pulse rounded-xl bg-slate-200" />
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        </div>
        <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>
    </main>
  );
}
