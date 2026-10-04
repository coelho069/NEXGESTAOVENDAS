"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  CreditCard,
  KeyRound,
  Settings2,
} from "lucide-react";
import { BrandMark } from "@/components/landing/components/BrandMark";
import { AdminSignOut } from "@/components/admin/admin-sign-out";

const activeItem = "bg-primary text-primary-foreground shadow-lg shadow-primary/25";
const inactiveItem = "text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground";

function navClass(active: boolean): string {
  return `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${active ? activeItem : inactiveItem}`;
}

function mobileNavClass(active: boolean): string {
  return `flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${active ? activeItem : inactiveItem}`;
}

export function AdminSidebar() {
  const pathname = usePathname();
  const isOverview = pathname === "/admin";
  const isSubscriptions = pathname.startsWith("/admin/assinaturas");
  const isPlans = pathname.startsWith("/admin/planos");
  const isClientAccounts = pathname.startsWith("/admin/clientes/contas");

  return (
    <>
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-card/50 backdrop-blur-xl lg:flex">
        <div className="border-b border-border px-6 py-6">
          <Link href="/admin" className="flex items-center gap-3">
            <BrandMark size={36} gradientId="nx-admin-sidebar-grad" />
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Nex Gestão
              </span>
              <span
                className="block text-lg font-bold tracking-tight text-foreground"
                style={{ fontFamily: "var(--font-jakarta), system-ui, sans-serif" }}
              >
                Administração
              </span>
            </span>
          </Link>
        </div>

        <nav aria-label="Navegação administrativa" className="flex flex-1 flex-col gap-1 px-4 py-6">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Operação
          </p>
          <Link href="/admin" className={navClass(isOverview)}>
            <BarChart3 size={19} aria-hidden="true" />
            Visão geral
          </Link>
          <Link href="/admin/assinaturas" className={navClass(isSubscriptions)}>
            <CreditCard size={19} aria-hidden="true" />
            Clientes e assinaturas
          </Link>
          <Link href="/admin/clientes/contas" className={navClass(isClientAccounts)}>
            <KeyRound size={19} aria-hidden="true" />
            Contas de clientes
          </Link>

          <p className="mt-8 px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Configuração
          </p>
          <Link href="/admin/planos" className={navClass(isPlans)}>
            <Building2 size={19} aria-hidden="true" />
            Planos
          </Link>
          <span
            title="Configurações administrativas ainda não estão disponíveis"
            className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-muted-foreground/50"
          >
            <Settings2 size={19} aria-hidden="true" />
            Configurações
          </span>
        </nav>

        <div className="space-y-2 border-t border-border p-4">
          <Link
            href="/pdv"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            Voltar ao PDV
          </Link>
          <AdminSignOut />
        </div>
      </aside>

      <nav
        aria-label="Navegação administrativa móvel"
        className="flex gap-2 overflow-x-auto border-b border-border bg-card/95 px-4 py-3 backdrop-blur-md lg:hidden"
      >
        <Link href="/admin" className={mobileNavClass(isOverview)}>
          <BarChart3 size={17} aria-hidden="true" />
          Visão geral
        </Link>
        <Link href="/admin/assinaturas" className={mobileNavClass(isSubscriptions)}>
          <CreditCard size={17} aria-hidden="true" />
          Assinaturas
        </Link>
        <Link href="/admin/clientes/contas" className={mobileNavClass(isClientAccounts)}>
          <KeyRound size={17} aria-hidden="true" />
          Contas
        </Link>
        <Link href="/admin/planos" className={mobileNavClass(isPlans)}>
          <Building2 size={17} aria-hidden="true" />
          Planos
        </Link>
        <Link href="/pdv" className={mobileNavClass(false)}>
          <ArrowLeft size={17} aria-hidden="true" />
          PDV
        </Link>
      </nav>
    </>
  );
}
