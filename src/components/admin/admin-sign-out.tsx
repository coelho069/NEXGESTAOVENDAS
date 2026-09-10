"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { endClientSession } from "@/lib/offline/end-session";

export function AdminSignOut() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        await endClientSession();
        router.replace("/login");
      }}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <LogOut size={18} aria-hidden="true" />
      <span className="font-medium">{loading ? "Saindo..." : "Sair"}</span>
    </button>
  );
}
