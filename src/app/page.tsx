import Link from "next/link";
import { ProductSearch } from "@/components/features/ProductSearch";
import { getAuthedContext } from "@/lib/auth/session";
import { fixtureStoreOptions, pdvFixturesEnabled } from "@/lib/pdv/fixtures";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const auth = await getAuthedContext();
  const fixtureMode = !auth && pdvFixturesEnabled();
  const stores = auth?.stores.map(({ id, name }) => ({ id, name })) ?? (fixtureMode ? fixtureStoreOptions() : []);
  const activeStoreQuery = auth?.storeId ? `?store=${encodeURIComponent(auth.storeId)}` : "";

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 p-6">
      <section className="flex flex-col items-start justify-center gap-6">
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
            href={`/pdv${activeStoreQuery}`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800"
          >
            Abrir PDV
          </Link>
          <Link
            href={`/inventory${activeStoreQuery}`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800"
          >
            Inventário
          </Link>
          <Link
            href={`/dashboard${activeStoreQuery}`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800"
          >
            Dashboard
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-xl font-semibold text-slate-900">Catálogo rápido</h2>
          <p className="text-sm text-slate-600">
            Selecione uma loja autorizada para adicionar produtos ao carrinho de venda.
          </p>
        </div>
        <ProductSearch scopeKey="home" stores={stores} initialStoreId={auth?.storeId} />
      </section>
    </main>
  );
}
