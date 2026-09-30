"use client";

import dynamic from "next/dynamic";

const SuporteOperacionalLazy = dynamic(
  () => import("./suporte-operacional").then((mod) => mod.SuporteOperacional),
  { ssr: false }
);

export function SuporteOperacionalClient() {
  return <SuporteOperacionalLazy />;
}
