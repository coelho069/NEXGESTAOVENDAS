"use client";

import Link from "next/link";
import {
  BarChart3,
  History,
  LogOut,
  Package,
  Settings,
  ShoppingCart,
  Users,
  type LucideIcon,
} from "lucide-react";
import { endClientSession } from "@/lib/offline/end-session";

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

const navItems: NavItem[] = [
  { href: "/pdv", icon: ShoppingCart, label: "Frente de Caixa" },
  { href: "/inventory", icon: Package, label: "Estoque" },
  { href: "/dashboard", icon: BarChart3, label: "Relatórios" },
];

function navItemClass(active: boolean): string {
  return active
    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200"
    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900";
}

function storeHref(path: string, storeId: string | null): string {
  return storeId ? `${path}?store=${encodeURIComponent(storeId)}` : path;
}

export function PdvSidebar({
  storeId,
  onOpenSalesHistory,
}: {
  storeId: string | null;
  onOpenSalesHistory?: () => void;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-8 border-r border-slate-200 bg-white px-4 py-5 lg:flex">
      <Link href={storeHref("/pdv", storeId)} className="flex items-center gap-2.5 px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          N
        </span>
        <span className="text-lg font-semibold tracking-tight text-slate-900">NexPDV</span>
      </Link>

      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1">
        {navItems.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={storeHref(href, storeId)}
            aria-current={href === "/pdv" ? "page" : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 transition-all ${navItemClass(href === "/pdv")}`}
          >
            <Icon size={20} aria-hidden="true" />
            <span className="font-medium">{label}</span>
          </Link>
        ))}
        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-4 py-3 text-left text-slate-400"
          title="Módulo ainda não disponível"
        >
          <Users size={20} aria-hidden="true" />
          <span className="font-medium">Clientes</span>
        </button>
        <button
          type="button"
          data-testid="sidebar-sales-history"
          onClick={onOpenSalesHistory}
          disabled={!onOpenSalesHistory}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-400"
          title="Consultar vendas da loja"
        >
          <History size={20} aria-hidden="true" />
          <span className="font-medium">Vendas</span>
        </button>
      </nav>

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-4 py-3 text-left text-slate-400"
          title="Configurações ainda não disponíveis"
        >
          <Settings size={20} aria-hidden="true" />
          <span className="font-medium">Configurações</span>
        </button>
        <button
          type="button"
          onClick={() => void endClientSession()}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-red-500 transition-all hover:bg-red-50"
        >
          <LogOut size={20} aria-hidden="true" />
          <span className="font-medium">Sair</span>
        </button>
      </div>
    </aside>
  );
}
