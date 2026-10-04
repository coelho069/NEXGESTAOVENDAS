import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { notFound } from "next/navigation";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { getPlatformAdminAccess } from "@/lib/auth/admin";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
  variable: "--font-jakarta",
});

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
    <div className={`admin-theme ${inter.variable} ${jakarta.variable} flex min-h-screen bg-background text-foreground`}>
      <AdminSidebar />
      <div className="min-w-0 flex-1">
        <div className="mx-auto min-h-screen max-w-[1600px]">{children}</div>
      </div>
    </div>
  );
}
