"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canManageInventory, canViewReports, type MemberRole } from "@/lib/domain/rbac";

function storeHref(path: string, storeId?: string | null): string {
  return storeId ? `${path}?store=${encodeURIComponent(storeId)}` : path;
}

function navItemClass(active: boolean): string {
  return active
    ? "rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white shadow-sm"
    : "rounded-lg px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900";
}

export function AppNav({ role, storeId }: { role?: MemberRole | null; storeId?: string | null }) {
  const pathname = usePathname();
  const onPdv = pathname === "/pdv" || pathname.startsWith("/pdv/");
  const onInventory = pathname === "/inventory" || pathname.startsWith("/inventory/");
  const onDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  return (
    <nav className="flex flex-wrap items-center gap-3 text-sm" aria-label="Navegação">
      <Link href={storeHref("/pdv", storeId)} className="flex items-center gap-2 pr-1">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          N
        </span>
        <span className="font-semibold tracking-tight text-slate-900">Nex Gestão</span>
      </Link>
      <div className="flex flex-wrap gap-1">
        <Link
          href={storeHref("/pdv", storeId)}
          aria-current={onPdv ? "page" : undefined}
          className={navItemClass(onPdv)}
        >
          PDV
        </Link>
        <Link
          href={storeHref("/inventory", storeId)}
          aria-current={onInventory ? "page" : undefined}
          className={navItemClass(onInventory)}
        >
          Inventário
        </Link>
        {canViewReports(role) ? (
          <Link
            href={storeHref("/dashboard", storeId)}
            aria-current={onDashboard ? "page" : undefined}
            className={navItemClass(onDashboard)}
          >
            Dashboard
          </Link>
        ) : null}
      </div>
      {canManageInventory(role) ? (
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">gestão</span>
      ) : null}
    </nav>
  );
}
