type HotkeyHint = {
  keys: string;
  label: string;
};

const HOTKEY_HINTS: HotkeyHint[] = [
  { keys: "F2", label: "Busca" },
  { keys: "Enter", label: "1º resultado" },
  { keys: "+/−", label: "Qtd" },
  { keys: "Del", label: "Remover" },
  { keys: "F4", label: "Desconto" },
  { keys: "F6", label: "Cliente" },
  { keys: "F8", label: "Dinheiro" },
  { keys: "F9", label: "Cartão" },
  { keys: "F10", label: "PIX" },
  { keys: "F12", label: "Finalizar" },
  { keys: "Esc", label: "Fechar" },
  { keys: "Ctrl+H", label: "Histórico" },
];

export function PdvHotkeysBar() {
  return (
    <footer
      data-testid="pdv-hotkeys-bar"
      className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur-sm"
      aria-label="Atalhos do PDV"
    >
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-center gap-x-3 gap-y-1">
        {HOTKEY_HINTS.map((hint) => (
          <span key={hint.keys} className="inline-flex items-center gap-1 text-xs text-slate-500">
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
              {hint.keys}
            </kbd>
            <span>{hint.label}</span>
          </span>
        ))}
      </div>
    </footer>
  );
}
