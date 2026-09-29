export type PdvShortcut =
  | "search"
  | "customer"
  | "discount"
  | "payCash"
  | "payCard"
  | "payPix"
  | "finalize"
  | "salesHistory"
  | "cancel"
  | "removeLine"
  | "qtyInc"
  | "qtyDec";

export type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
};

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  if (el.isContentEditable) return true;
  return EDITABLE_TAGS.has(el.tagName ?? "");
}

export function matchPdvShortcut(event: KeyLike): PdvShortcut | null {
  const key = event.key;
  const mod = event.ctrlKey || event.metaKey;

  if (mod && (key === "k" || key === "K")) return "search";
  if (mod && (key === "h" || key === "H")) return "salesHistory";
  if (event.altKey) return null;

  switch (key) {
    case "F2":
      return "search";
    case "F4":
      return "discount";
    case "F6":
      return "customer";
    case "F8":
      return "payCash";
    case "F9":
      return "payCard";
    case "F10":
      return "payPix";
    case "F12":
      return "finalize";
    case "Escape":
      return "cancel";
    case "Delete":
    case "Backspace":
      return "removeLine";
    case "+":
    case "=":
      return "qtyInc";
    case "-":
    case "_":
      return "qtyDec";
    default:
      return null;
  }
}

const MODAL_ALLOWED_SHORTCUTS = new Set<PdvShortcut>(["cancel", "payCash", "payCard", "payPix"]);

export function shouldHandleShortcut(
  shortcut: PdvShortcut,
  target: EventTarget | null,
  modalOpen = false
): boolean {
  if (modalOpen && !MODAL_ALLOWED_SHORTCUTS.has(shortcut)) return false;
  const editable = isEditableTarget(target);
  const search = isPdvSearchTarget(target);

  if (shortcut === "cancel") return true;
  if (shortcut === "search") return true;
  if (editable && !search) return false;
  if (search) return false;
  if (shortcut === "qtyInc" || shortcut === "qtyDec" || shortcut === "removeLine") {
    return !editable;
  }
  return true;
}

export const PDV_SEARCH_TEST_ID = "pdv-search-input";

export function isPdvSearchTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { id?: string; getAttribute?: (name: string) => string | null };
  if (el.id === "pdv-search-input") return true;
  return el.getAttribute?.("data-testid") === PDV_SEARCH_TEST_ID;
}

export function shouldAcceptHidScan(target: EventTarget | null, modalOpen: boolean): boolean {
  if (modalOpen) return false;
  if (isEditableTarget(target) && !isPdvSearchTarget(target)) return false;
  return true;
}

export type PdvHotkeyHint = {
  shortcut: PdvShortcut | "enterFirstResult";
  keys: string;
  label: string;
};

export const PDV_SHORTCUT_KEY_LABELS: Record<PdvShortcut, string> = {
  search: "F2",
  customer: "F6",
  discount: "F4",
  payCash: "F8",
  payCard: "F9",
  payPix: "F10",
  finalize: "F12",
  salesHistory: "Ctrl+H",
  cancel: "Esc",
  removeLine: "Del",
  qtyInc: "+/−",
  qtyDec: "+/−",
};

export const PDV_SHORTCUT_LABELS: Record<PdvShortcut, string> = {
  search: "Busca",
  customer: "Cliente",
  discount: "Desconto",
  payCash: "Dinheiro",
  payCard: "Cartão",
  payPix: "PIX próprio",
  finalize: "Finalizar",
  salesHistory: "Histórico",
  cancel: "Fechar",
  removeLine: "Remover",
  qtyInc: "Qtd",
  qtyDec: "Qtd",
};

export type PdvShortcutAvailability = {
  card?: boolean;
};

export function getPdvShortcutKeyLabel(shortcut: PdvShortcut): string {
  return PDV_SHORTCUT_KEY_LABELS[shortcut];
}

export function getPdvShortcutLabel(shortcut: PdvShortcut): string {
  return PDV_SHORTCUT_LABELS[shortcut];
}

export function formatPdvShortcutHint(shortcut: PdvShortcut): string {
  return `${getPdvShortcutLabel(shortcut)} (${getPdvShortcutKeyLabel(shortcut)})`;
}

/** Bar/footer hints derived from the same shortcut map as matchPdvShortcut. */
export function buildPdvHotkeyHints(
  availability: PdvShortcutAvailability = {}
): PdvHotkeyHint[] {
  const cardAvailable = availability.card ?? false;

  const hints: PdvHotkeyHint[] = [
    { shortcut: "search", keys: getPdvShortcutKeyLabel("search"), label: getPdvShortcutLabel("search") },
    { shortcut: "enterFirstResult", keys: "Enter", label: "1º resultado" },
    { shortcut: "qtyInc", keys: "+/−", label: "Qtd" },
    { shortcut: "removeLine", keys: getPdvShortcutKeyLabel("removeLine"), label: getPdvShortcutLabel("removeLine") },
    { shortcut: "discount", keys: getPdvShortcutKeyLabel("discount"), label: getPdvShortcutLabel("discount") },
    { shortcut: "customer", keys: getPdvShortcutKeyLabel("customer"), label: getPdvShortcutLabel("customer") },
    { shortcut: "payCash", keys: getPdvShortcutKeyLabel("payCash"), label: getPdvShortcutLabel("payCash") },
  ];

  if (cardAvailable) {
    hints.push({
      shortcut: "payCard",
      keys: getPdvShortcutKeyLabel("payCard"),
      label: getPdvShortcutLabel("payCard"),
    });
  }

  hints.push(
    {
      shortcut: "payPix",
      keys: getPdvShortcutKeyLabel("payPix"),
      label: getPdvShortcutLabel("payPix"),
    },
    {
      shortcut: "finalize",
      keys: getPdvShortcutKeyLabel("finalize"),
      label: getPdvShortcutLabel("finalize"),
    },
    {
      shortcut: "cancel",
      keys: getPdvShortcutKeyLabel("cancel"),
      label: getPdvShortcutLabel("cancel"),
    },
    {
      shortcut: "salesHistory",
      keys: getPdvShortcutKeyLabel("salesHistory"),
      label: getPdvShortcutLabel("salesHistory"),
    }
  );

  return hints;
}
