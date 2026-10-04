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
import { BrandMark } from "@/components/landing/components/BrandMark";
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
  { href: "/clientes", icon: Users, label: "Clientes" },
];

function navItemClass(active: boolean): string {
  return active
    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
    : "text-muted-foreground hover:bg-white/5 hover:text-foreground";
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
    <aside className="hidden w-64 shrink-0 flex-col gap-8 border-r border-border bg-card/50 p-4 backdrop-blur-xl lg:flex">
      <Link href={storeHref("/pdv", storeId)} className="flex items-center gap-2.5 px-2">
        <BrandMark size={32} gradientId="nx-pdv-sidebar-grad" />
        <span
          className="text-xl font-bold tracking-tight text-foreground"
          style={{ fontFamily: "var(--font-jakarta), system-ui, sans-serif" }}
        >
          NexPDV
        </span>
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
          data-testid="sidebar-sales-history"
          onClick={onOpenSalesHistory}
          disabled={!onOpenSalesHistory}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground transition-all hover:bg-white/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          title="Consultar vendas da loja"
        >
          <History size={20} aria-hidden="true" />
          <span className="font-medium">Vendas</span>
        </button>
      </nav>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground/60"
          title="Configurações ainda não disponíveis"
        >
          <Settings size={20} aria-hidden="true" />
          <span className="font-medium">Configurações</span>
        </button>
        <button
          type="button"
          onClick={() => void endClientSession()}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-destructive transition-all hover:bg-destructive/10"
        >
          <LogOut size={20} aria-hidden="true" />
          <span className="font-medium">Sair</span>
        </button>
      </div>
    </aside>
  );
}
