"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { formatBRL } from "@/lib/money";
import type { PendingPixCheckout } from "@/stores/pdv-ui-store";

type PixQrSheetProps = {
  open: boolean;
  pending: PendingPixCheckout | null;
  storeId: string | null;
  onClose: () => void;
  onCancel: () => Promise<void>;
  onConfirmed: (input: { saleId: string; providerReference: string }) => Promise<void>;
};

export function PixQrSheet({
  open,
  pending,
  storeId,
  onClose,
  onCancel,
  onConfirmed,
}: PixQrSheetProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!open || !pending || !storeId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/payments/reconcile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            store_id: storeId,
            client_mutation_id: pending.clientMutationId,
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          sale_confirmed?: unknown;
          status?: unknown;
          sale_id?: unknown;
          provider_reference?: unknown;
        };
        if (cancelled) return;
        if (
          body.sale_confirmed === true &&
          typeof body.sale_id === "string" &&
          typeof body.provider_reference === "string"
        ) {
          await onConfirmed({
            saleId: body.sale_id,
            providerReference: body.provider_reference,
          });
        }
      } catch {
        if (!cancelled) {
          setMessage("Aguardando confirmação do PIX…");
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onConfirmed, open, pending, storeId]);

  if (!open || !pending) return null;

  const qr = pending.qr;

  return (
    <div data-testid="pdv-pix-qr-sheet" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        aria-label="Fechar PIX"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-6">
          <h2 className="text-xl font-bold text-slate-900">Pagar com PIX</h2>
          <button
            type="button"
            className="text-slate-400 transition hover:text-slate-700"
            aria-label="Fechar PIX"
            onClick={onClose}
          >
            <X size={24} aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-4 p-6 text-center">
          <p className="text-sm text-slate-600">
            QR gerado. A venda só confirma depois do PaymentIntent <code>succeeded</code>.
          </p>
          <p className="text-2xl font-black text-indigo-900">{formatBRL(pending.amount)}</p>
          {qr?.imageUrlPng ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              data-testid="pix-qr-image"
              src={qr.imageUrlPng}
              alt="QR Code PIX"
              className="mx-auto h-56 w-56 rounded-xl border border-slate-200 bg-white p-2"
            />
          ) : (
            <pre
              data-testid="pix-qr-payload"
              className="overflow-x-auto rounded-xl bg-slate-50 p-3 text-left text-xs text-slate-700"
            >
              {qr?.data ?? "QR indisponível. Reconcilie ou cancele."}
            </pre>
          )}
          {qr?.data ? (
            <p data-testid="pix-copy-paste" className="break-all text-left text-xs text-slate-500">
              {qr.data}
            </p>
          ) : null}
          <p className="text-sm text-slate-500">{message ?? "Aguardando pagamento PIX…"}</p>
          <button
            type="button"
            data-testid="pix-cancel"
            disabled={cancelling}
            onClick={() => {
              setCancelling(true);
              void onCancel().finally(() => setCancelling(false));
            }}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-indigo-300 disabled:opacity-50"
          >
            Cancelar PIX
          </button>
        </div>
      </div>
    </div>
  );
}
