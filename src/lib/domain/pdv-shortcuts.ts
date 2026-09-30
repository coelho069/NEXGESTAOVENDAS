export type PdvShortcut =
  | "search"
  | "customer"
  | "discount"
  | "payment"
  | "receipt"
  | "cancel"
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
  if (event.altKey) return null;

  switch (key) {
    case "F2":
      return "search";
    case "F4":
      return "customer";
    case "F6":
      return "discount";
    case "F8":
      return "payment";
    case "F9":
      return "receipt";
    case "Escape":
      return "cancel";
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

export function shouldHandleShortcut(
  shortcut: PdvShortcut,
  target: EventTarget | null,
  modalOpen = false
): boolean {
  if (modalOpen && shortcut !== "cancel") return false;
  const editable = isEditableTarget(target);
  const search = isPdvSearchTarget(target);

  if (shortcut === "cancel") return true;
  if (shortcut === "search") return true;
  if (editable && !search) return false;
  if (search) return false;
  if (shortcut === "qtyInc" || shortcut === "qtyDec") {
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