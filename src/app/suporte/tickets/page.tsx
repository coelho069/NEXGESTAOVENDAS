import type { Metadata } from "next";
import { Ticket } from "lucide-react";
import Link from "next/link";
import { getSupportWhatsAppUrl } from "@/lib/support/whatsapp";

export const metadata: Metadata = {
  title: "Suporte · Tickets — Nex Gestão Vendas",
  description: "Acompanhe os chamados de suporte do PDV Nex Gestão Vendas.",
};

/**
 * Página de tickets de suporte (rota alvo do FAB).
 * Sem backend de tickets no Sprint 4: estado honesto + canais reais configurados.
 */
export default function TicketsPage() {
  const whatsappUrl = getSupportWhatsAppUrl();

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
        <p className="font-medium text-slate-800">Abertura de chamados em breve</p>
        <p className="mt-2">
          Ainda não há backend de tickets nesta versão. Enquanto isso, use os canais
          abaixo para suporte operacional.
        </p>

        <ul className="mt-4 space-y-2 text-slate-700">
          <li>
            <span className="font-medium">Painel de suporte no PDV:</span>{" "}
            pressione F1 ou Ctrl+/ no caixa para abrir o Suporte Operacional.
          </li>
          {whatsappUrl ? (
            <li>
              <span className="font-medium">WhatsApp:</span>{" "}
              atendimento humano para incidentes de caixa (impressora, rede, sync).
            </li>
          ) : null}
        </ul>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium transition-colors hover:bg-slate-50"
          >
            Voltar ao início
          </Link>
          {whatsappUrl ? (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="tickets-whatsapp-cta"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Abrir WhatsApp
            </a>
          ) : null}
        </div>
      </div>
    </main>
  );
}
