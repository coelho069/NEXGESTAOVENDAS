import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { getPlatformAdminAccess } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ADM — Nex Gestão Vendas",
  description: "Administração de clientes e assinaturas do Nex Gestão Vendas",
};

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const access = await getPlatformAdminAccess();
  if (!access) notFound();

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <AdminSidebar />
      <div className="min-w-0 flex-1">
        <div className="mx-auto min-h-screen max-w-[1600px]">{children}</div>
      </div>
    </div>
  );
}
