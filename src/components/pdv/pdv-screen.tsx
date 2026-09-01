"use client";

import { useMemo, useState } from "react";
import { ProductGrid } from "@/components/pdv/product-grid";
import { CartPanel } from "@/components/pdv/cart-panel";
import { ConflictBanner } from "@/components/pdv/conflict-banner";
import { SyncStatusBadge } from "@/components/pdv/sync-status-badge";
import { useProducts } from "@/hooks/use-products";
import { useCheckout } from "@/hooks/use-checkout";
import { useCartStore } from "@/stores/cart-store";
import { useSyncStore } from "@/stores/sync-store";
import { searchProducts } from "@/lib/domain/product";
import { parseUnitPrice } from "@/lib/domain/sale";

const DEMO_STORES = [
  { id: "22222222-2222-4222-8222-222222222201", name: "Loja Centro" },
  { id: "22222222-2222-4222-8222-222222222202", name: "Loja Shopping" },
];

export function PdvScreen() {
  const { products, loading, error } = useProducts();
  const { storeId, setStoreId, lines, addLine, updateQuantity, removeLine, discount, total } =
    useCartStore();
  const { online, pendingCount, syncing, conflicts, quotaExceeded, sessionEnded } = useSyncStore();
  const { checkoutCash } = useCheckout();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const filtered = useMemo(() => searchProducts(products, query), [products, query]);

  const handleCheckout = async () => {
    setMessage(null);
    try {
      const result = await checkoutCash();
      if ("offline" in result && result.offline) {
        setMessage("Venda salva localmente. Será sincronizada quando a conexão voltar.");
      } else {
        setMessage(`Venda confirmada: ${result.saleId ?? "ok"}`);
      }
    } catch (checkoutError) {
      setMessage(checkoutError instanceof Error ? checkoutError.message : "Erro no checkout");
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">PDV Local-first</h1>
          <p className="text-sm text-slate-500">Sprint 2 — Dexie outbox, sync e conflito visível</p>
        </div>
        <SyncStatusBadge
          online={online}
          pendingCount={pendingCount}
          syncing={syncing}
          conflictCount={conflicts.length}
        />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-slate-700" htmlFor="store">
          Loja
        </label>
        <select
          id="store"
          className="rounded-lg border border-slate-300 px-3 py-2"
          value={storeId ?? ""}
          onChange={(event) => setStoreId(event.target.value)}
        >
          <option value="">Selecione...</option>
          {DEMO_STORES.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
        <input
          className="min-w-[240px] flex-1 rounded-lg border border-slate-300 px-3 py-2"
          placeholder="Buscar produto, SKU ou código de barras"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {sessionEnded ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Sessão encerrada. Faça login novamente.
        </div>
      ) : null}

      {quotaExceeded ? (
        <div
          role="alert"
          data-testid="quota-exceeded"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          Armazenamento local cheio. Libere espaço antes de fechar novas vendas.
        </div>
      ) : null}

      <ConflictBanner conflicts={conflicts} />

      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="grid flex-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <section>
          {loading ? (
            <p className="text-slate-500">Carregando produtos...</p>
          ) : (
            <ProductGrid
              products={filtered}
              onAdd={(product) =>
                addLine({
                  productId: product.id,
                  sku: product.sku,
                  name: product.name,
                  unitPrice: parseUnitPrice(product.unit_price),
                  quantity: 1,
                  discount: "0.00",
                })
              }
            />
          )}
        </section>
        <CartPanel
          lines={lines}
          discount={discount}
          total={total()}
          checkoutDisabled={!storeId || syncing}
          onIncrement={(productId) => {
            const line = lines.find((item) => item.productId === productId);
            if (line) updateQuantity(productId, line.quantity + 1);
          }}
          onDecrement={(productId) => {
            const line = lines.find((item) => item.productId === productId);
            if (line) updateQuantity(productId, line.quantity - 1);
          }}
          onRemove={removeLine}
          onCheckout={() => void handleCheckout()}
        />
      </div>
    </div>
  );
}
