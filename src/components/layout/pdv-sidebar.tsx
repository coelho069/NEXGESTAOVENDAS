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
  onOpenCustomers,
  onOpenSalesHistory,
  onOpenSettings,
}: {
  storeId: string | null;
  onOpenCustomers?: () => void;
  onOpenSalesHistory?: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-8 border-r border-slate-200 bg-white p-4 lg:flex">
      <Link href={storeHref("/pdv", storeId)} className="flex items-center gap-2 px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">
          P
        </span>
        <span className="text-xl font-bold tracking-tight text-slate-900">NexPDV</span>
      </Link>

      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-2">
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
          data-testid="sidebar-customers"
          onClick={onOpenCustomers}
          disabled={!onOpenCustomers}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-400"
          title={onOpenCustomers ? "Associar cliente à venda atual" : "Módulo ainda não disponível"}
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
          data-testid="sidebar-settings"
          onClick={onOpenSettings}
          disabled={!onOpenSettings}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-400"
          title={onOpenSettings ? "Configurações da loja e do PDV" : "Selecione uma loja para abrir configurações"}
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
