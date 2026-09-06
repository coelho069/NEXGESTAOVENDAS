/**
 * B25 — Server-side printer helpers.
 *
 * The Next.js server must NEVER:
 * - open arbitrary TCP/UDP sockets to client-supplied hosts
 * - exec shell commands for printing
 * - accept USB device paths from the client
 * - store hardware secrets in plaintext settings
 *
 * Hardware modes remain `printer_not_configured` until a secure local bridge exists.
 */

import {
  defaultPrinterConfigView,
  normalizePaperWidthMm,
  normalizePrintMode,
  rejectShellPrinterExecution,
  validateNetworkPrinterDestination,
  type PaperWidthMm,
  type PrintMode,
  type PrinterConfigView,
} from "@/lib/domain/printer";
import { resolvePrinterConfigView } from "@/lib/adapters/printer";

export type ServerPrinterSettings = {
  print_mode: PrintMode;
  paper_width_mm: PaperWidthMm;
  auto_print_receipt: boolean;
};

/**
 * Resolve public printer status for a store. Never probes remote hosts.
 */
export function getPublicPrinterStatus(settings: {
  print_mode?: string | null;
  paper_width_mm?: number | string | null;
  auto_print_receipt?: boolean | null;
}): PrinterConfigView {
  return resolvePrinterConfigView({
    mode: settings.print_mode,
    paperWidthMm: settings.paper_width_mm,
    autoPrintReceipt: Boolean(settings.auto_print_receipt),
  });
}

/**
 * Server refuses to dial network printers. Validates and rejects destinations.
 */
export function refuseServerNetworkPrint(host: unknown, port: unknown) {
  return validateNetworkPrinterDestination(host, port);
}

/**
 * Explicit hard-fail for any attempt to shell-out from server print paths.
 */
export function refuseShellPrint(userInput: string): never {
  return rejectShellPrinterExecution(userInput);
}

export function normalizeServerPrinterSettings(input: {
  print_mode?: unknown;
  paper_width_mm?: unknown;
  auto_print_receipt?: unknown;
}): ServerPrinterSettings {
  return {
    print_mode: normalizePrintMode(input.print_mode),
    paper_width_mm: normalizePaperWidthMm(input.paper_width_mm),
    auto_print_receipt: Boolean(input.auto_print_receipt),
  };
}

/**
 * Capability probe used by health-adjacent diagnostics — does not touch hardware.
 */
export function probePrinterCapability(mode: PrintMode): PrinterConfigView {
  if (mode === "browser") {
    return defaultPrinterConfigView({ mode: "browser", browserAvailable: true });
  }
  return defaultPrinterConfigView({ mode, browserAvailable: true });
}
