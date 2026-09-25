import type { Metadata } from "next";
import { Ticket } from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Suporte · Tickets — Nex Gestão Vendas",
  description: "Acompanhe os chamados de suporte do PDV Nex Gestão Vendas.",
};

/**
 * Página de tickets de suporte (rota alvo do FAB).
 * Server Component estático: lista o fluxo de atendimento; a persistência
 * de tickets (tabela + RLS) entra quando o backend for definido.
 */
export default function TicketsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <Ticket size={22} />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Tickets de Suporte</h1>
          <p className="text-sm text-slate-500">
            Chamados do sistema NEX Gestão Vendas
          </p>
        </div>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
        <p className="font-medium text-slate-800">Nenhum ticket ainda</p>
        <p className="mt-1">
          Precisa de ajuda agora? Fale com o suporte pelo WhatsApp — o atendimento
          é mais rápido para incidentes de caixa (impressora, rede, sync).
        </p>
        <div className="mt-4 flex gap-2">
          <Link
            href="/"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium transition-colors hover:bg-slate-50"
          >
            Voltar ao início
          </Link>
          <a
            href={`https://wa.me/${process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "5511999999999"}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-emerald-700"
          >
            Abrir WhatsApp
          </a>
        </div>
      </div>
    </main>
  );
}
