import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 p-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Sprint 4</p>
        <h1 className="mt-2 text-4xl font-bold text-slate-900">Nex Gestão Vendas</h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Inventário auditado, dashboard de rentabilidade (COGS, margem, sell-through) e RBAC no servidor.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/login"
          className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
        >
          Entrar
        </Link>
        <Link
          href="/pdv"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800"
        >
          Abrir PDV
        </Link>
        <Link
          href="/inventory"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800"
        >
          Inventário
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800"
        >
          Dashboard
        </Link>
      </div>
    </main>
  );
}
