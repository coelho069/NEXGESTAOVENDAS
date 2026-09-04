import { validate as validateUuid, v4 as uuidv4 } from "uuid";

export const TERMINAL_ID_STORAGE_KEY = "nex-terminal-id";

export function getTerminalId(): string {
  if (typeof localStorage === "undefined") {
    return uuidv4();
  }

  const stored = localStorage.getItem(TERMINAL_ID_STORAGE_KEY);
  if (stored && validateUuid(stored)) {
    return stored;
  }

  const terminalId = uuidv4();
  localStorage.setItem(TERMINAL_ID_STORAGE_KEY, terminalId);
  return terminalId;
}
