"use client";

import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { openAnneSupport } from "@/lib/support/open-anne-support";

type OpenAnneSupportButtonProps = {
  label?: string;
  className?: string;
  testId?: string;
  loginRedirectPath?: string;
  onOpen?: () => void;
};

export function OpenAnneSupportButton({
  label = "Falar com o suporte",
  className = "flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700",
  testId = "open-anne-support-cta",
  loginRedirectPath = "/login",
  onOpen,
}: OpenAnneSupportButtonProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  const handleClick = () => {
    if (loading) return;
    if (!user) {
      router.push(loginRedirectPath);
      return;
    }
    onOpen?.();
    openAnneSupport();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      data-testid={testId}
      className={className}
    >
      <MessageCircle size={18} aria-hidden="true" />
      {label}
    </button>
  );
}
