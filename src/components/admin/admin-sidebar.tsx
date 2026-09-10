"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  CreditCard,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { AdminSignOut } from "@/components/admin/admin-sign-out";

const activeItem =
  "bg-indigo-600 text-white shadow-lg shadow-indigo-200";
const inactiveItem =
  "text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900";

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

  return (
    <>
      <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-100 px-6 py-6">
          <Link href="/admin" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
              <ShieldCheck size={22} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
                Nex Gestão
              </span>
              <span className="block text-lg font-bold tracking-tight text-slate-900">
                Administração
              </span>
            </span>
          </Link>
        </div>

        <nav aria-label="Navegação administrativa" className="flex flex-1 flex-col gap-1 px-4 py-6">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
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

          <p className="mt-8 px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Configuração
          </p>
          <Link href="/admin/planos" className={navClass(isPlans)}>
            <Building2 size={19} aria-hidden="true" />
            Planos
          </Link>
          <span
            title="Configurações administrativas ainda não estão disponíveis"
            className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-slate-300"
          >
            <Settings2 size={19} aria-hidden="true" />
            Configurações
          </span>
        </nav>

        <div className="space-y-2 border-t border-slate-100 p-4">
          <Link
            href="/pdv"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            Voltar ao PDV
          </Link>
          <AdminSignOut />
        </div>
      </aside>

      <nav
        aria-label="Navegação administrativa móvel"
        className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-3 lg:hidden"
      >
        <Link href="/admin" className={mobileNavClass(isOverview)}>
          <BarChart3 size={17} aria-hidden="true" />
          Visão geral
        </Link>
        <Link href="/admin/assinaturas" className={mobileNavClass(isSubscriptions)}>
          <CreditCard size={17} aria-hidden="true" />
          Assinaturas
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
