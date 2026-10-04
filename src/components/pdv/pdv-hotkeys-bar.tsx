type HotkeyHint = {
  keys: string;
  label: string;
};

const HOTKEY_HINTS: HotkeyHint[] = [
  { keys: "F2", label: "Busca" },
  { keys: "Enter", label: "1º resultado" },
  { keys: "+/−", label: "Qtd" },
  { keys: "F4", label: "Editar qtd" },
  { keys: "F8", label: "Desconto" },
  { keys: "F9", label: "Cancelar item" },
  { keys: "F6", label: "Cliente" },
  { keys: "F10", label: "PIX" },
  { keys: "F12", label: "Finalizar" },
  { keys: "Esc", label: "Fechar" },
  { keys: "Ctrl+H", label: "Histórico" },
];

export function PdvHotkeysBar() {
  return (
    <footer
      data-testid="pdv-hotkeys-bar"
      className="sticky bottom-0 z-20 border-t border-border bg-card/95 px-3 py-2 backdrop-blur-md"
      aria-label="Atalhos do PDV"
    >
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-center gap-x-3 gap-y-1">
        {HOTKEY_HINTS.map((hint) => (
          <span key={hint.keys} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <kbd className="pdv-kbd">{hint.keys}</kbd>
            <span>{hint.label}</span>
          </span>
        ))}
      </div>
    </footer>
  );
}
