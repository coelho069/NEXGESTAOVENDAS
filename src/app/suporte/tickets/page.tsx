import type { Metadata } from "next";
import { Ticket } from "lucide-react";
import Link from "next/link";
import { OpenAnneSupportButton } from "@/components/support/open-anne-support-button";

export const metadata: Metadata = {
  title: "Suporte · Tickets — Nex Gestão Vendas",
  description: "Acompanhe os chamados de suporte do PDV Nex Gestão Vendas.",
};

export default function TicketsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <Ticket size={22} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Tickets de Suporte</h1>
          <p className="text-sm text-slate-500">Chamados do sistema NEX Gestão Vendas</p>
        </div>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
        <p className="font-medium text-slate-800">Abertura de chamados em breve</p>
        <p className="mt-2">
          Ainda não há backend de tickets nesta versão. Enquanto isso, use os canais abaixo para
          suporte operacional.
        </p>

        <ul className="mt-4 space-y-2 text-slate-700">
          <li>
            <span className="font-medium">Painel de suporte no PDV:</span> pressione F1 ou Ctrl+/
            no caixa para abrir o Suporte Operacional.
          </li>
          <li>
            <span className="font-medium">Chat de suporte:</span> fale com a Anne, assistente
            virtual, para incidentes de caixa (impressora, rede, sincronização).
          </li>
        </ul>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium transition-colors hover:bg-slate-50"
          >
            Voltar ao início
          </Link>
          <OpenAnneSupportButton
            label="Abrir chat de suporte"
            testId="tickets-anne-chat-cta"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-emerald-700"
          />
        </div>
      </div>
    </main>
  );
}
