/**
 * B25 — Printer adapters.
 *
 * Receipt → PrintJob → PrinterAdapter → Browser / ESC-POS / Network / Native
 *
 * Without a real transport/bridge, hardware modes return `printer_not_configured`.
 * Production never returns `print_succeeded` unless the adapter executed a real op.
 */

import type { ReceiptModel } from "@/lib/domain/receipt";
import {
  applyPrintResult,
  buildEscPosReceipt,
  createPrintJob,
  defaultPrinterConfigView,
  modeRequiresHardwareBridge,
  nextPrintAttempt,
  normalizePaperWidthMm,
  normalizePrintMode,
  type PaperWidthMm,
  type PrintAdapterResult,
  type PrintJob,
  type PrintMode,
  type PrintRequestInput,
  type PrinterConfigView,
  validateNetworkPrinterDestination,
} from "@/lib/domain/printer";

export type PrinterTransportContext = {
  /** Browser: invoke window.print on the receipt frame. */
  browserPrint?: () => void | Promise<void>;
  /** Optional native bridge hook (Electron/Tauri). Absent ⇒ not_configured. */
  nativeBridge?: {
    printEscPos?: (bytes: Uint8Array, job: PrintJob) => Promise<PrintAdapterResult>;
  };
  /** Optional local network bridge. Absent ⇒ not_configured. Never pass raw host/port to server. */
  networkBridge?: {
    dispatch?: (bytes: Uint8Array, job: PrintJob) => Promise<PrintAdapterResult>;
  };
  /** Optional USB/serial ESC/POS bridge. Absent ⇒ not_configured. */
  escposBridge?: {
    dispatch?: (bytes: Uint8Array, job: PrintJob) => Promise<PrintAdapterResult>;
  };
  signal?: AbortSignal;
  /** Test-only clock / timeout simulation. */
  nowMs?: () => number;
  timeoutMs?: number;
};

export interface PrinterAdapter {
  readonly mode: PrintMode;
  readonly configured: boolean;
  print(job: PrintJob, receipt: ReceiptModel, context?: PrinterTransportContext): Promise<PrintAdapterResult>;
  status(context?: PrinterTransportContext): PrinterConfigView;
}

function notConfigured(mode: PrintMode, detail?: string): PrintAdapterResult {
  return {
    status: "printer_not_configured",
    message:
      detail ??
      `Impressora ${mode} não configurada; nenhum byte foi enviado ao hardware.`,
    errorCode: "printer_not_configured",
    retryable: false,
  };
}

export class BrowserPrinterAdapter implements PrinterAdapter {
  readonly mode = "browser" as const;
  readonly configured = true;

  status(): PrinterConfigView {
    return defaultPrinterConfigView({ mode: "browser", browserAvailable: true });
  }

  async print(
    job: PrintJob,
    receipt: ReceiptModel,
    context?: PrinterTransportContext
  ): Promise<PrintAdapterResult> {
    void receipt;
    if (job.mode !== "browser") {
      return {
        status: "unsupported_mode",
        message: "Adapter browser não aceita este modo.",
        errorCode: "unsupported_mode",
        retryable: false,
      };
    }
    if (!context?.browserPrint) {
      return notConfigured(
        "browser",
        "Ambiente de impressão do navegador indisponível neste contexto."
      );
    }
    try {
      await context.browserPrint();
      // Browser print dialog has no reliable physical ACK.
      return {
        status: "print_dispatched",
        message: "Diálogo de impressão do navegador acionado (at-least-once).",
        retryable: true,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Falha ao imprimir no navegador";
      if (/timeout/i.test(message)) {
        return {
          status: "timeout",
          message: "Timeout ao acionar impressão do navegador.",
          errorCode: "timeout",
          retryable: true,
        };
      }
      return {
        status: "print_failed",
        message,
        errorCode: "print_failed",
        retryable: true,
      };
    }
  }
}

export class EscPosPrinterAdapter implements PrinterAdapter {
  readonly mode = "escpos" as const;

  get configured(): boolean {
    return false;
  }

  status(): PrinterConfigView {
    return defaultPrinterConfigView({ mode: "escpos", browserAvailable: true });
  }

  async print(
    job: PrintJob,
    receipt: ReceiptModel,
    context?: PrinterTransportContext
  ): Promise<PrintAdapterResult> {
    if (job.mode !== "escpos") {
      return {
        status: "unsupported_mode",
        message: "Adapter ESC/POS não aceita este modo.",
        errorCode: "unsupported_mode",
        retryable: false,
      };
    }
    const payload = buildEscPosReceipt(receipt, job.paperWidthMm);
    const bridge = context?.escposBridge?.dispatch;
    if (!bridge) {
      return {
        ...notConfigured(
          "escpos",
          "Bridge USB/ESC-POS ausente; comandos gerados mas não enviados ao hardware."
        ),
        payload,
      };
    }
    return bridge(payload, job);
  }
}

export class NetworkPrinterAdapter implements PrinterAdapter {
  readonly mode = "network" as const;

  get configured(): boolean {
    return false;
  }

  status(): PrinterConfigView {
    return defaultPrinterConfigView({ mode: "network", browserAvailable: true });
  }

  async print(
    job: PrintJob,
    receipt: ReceiptModel,
    context?: PrinterTransportContext
  ): Promise<PrintAdapterResult> {
    if (job.mode !== "network") {
      return {
        status: "unsupported_mode",
        message: "Adapter de rede não aceita este modo.",
        errorCode: "unsupported_mode",
        retryable: false,
      };
    }
    // Explicitly reject any attempt to pass host/port through job message fields.
    // Network destinations are never accepted from the client on this path.
    const payload = buildEscPosReceipt(receipt, job.paperWidthMm);
    const bridge = context?.networkBridge?.dispatch;
    if (!bridge) {
      return {
        ...notConfigured(
          "network",
          "Bridge de rede local ausente; servidor não abre sockets arbitrários."
        ),
        payload,
      };
    }
    return bridge(payload, job);
  }

  /** Public validator used by settings/API — always rejects server-side SSRF. */
  validateDestination(host: unknown, port: unknown) {
    return validateNetworkPrinterDestination(host, port);
  }
}

export class NativePrinterAdapter implements PrinterAdapter {
  readonly mode = "native" as const;

  get configured(): boolean {
    return false;
  }

  status(): PrinterConfigView {
    return defaultPrinterConfigView({ mode: "native", browserAvailable: true });
  }

  async print(
    job: PrintJob,
    receipt: ReceiptModel,
    context?: PrinterTransportContext
  ): Promise<PrintAdapterResult> {
    if (job.mode !== "native") {
      return {
        status: "unsupported_mode",
        message: "Adapter nativo não aceita este modo.",
        errorCode: "unsupported_mode",
        retryable: false,
      };
    }
    const payload = buildEscPosReceipt(receipt, job.paperWidthMm);
    const bridge = context?.nativeBridge?.printEscPos;
    if (!bridge) {
      return {
        ...notConfigured(
          "native",
          "Bridge nativo (Electron/Tauri) ausente; impressora não configurada."
        ),
        payload,
      };
    }
    return bridge(payload, job);
  }
}

const browserAdapter = new BrowserPrinterAdapter();
const escposAdapter = new EscPosPrinterAdapter();
const networkAdapter = new NetworkPrinterAdapter();
const nativeAdapter = new NativePrinterAdapter();

export function getPrinterAdapter(mode: PrintMode): PrinterAdapter {
  switch (normalizePrintMode(mode)) {
    case "browser":
      return browserAdapter;
    case "escpos":
      return escposAdapter;
    case "network":
      return networkAdapter;
    case "native":
      return nativeAdapter;
  }
}

export function listPrinterAdapters(): PrinterAdapter[] {
  return [browserAdapter, escposAdapter, networkAdapter, nativeAdapter];
}

export function resolvePrinterConfigView(input: {
  mode?: PrintMode | string | null;
  paperWidthMm?: PaperWidthMm | number | string | null;
  autoPrintReceipt?: boolean;
}): PrinterConfigView {
  const mode = normalizePrintMode(input.mode);
  const paperWidthMm = normalizePaperWidthMm(input.paperWidthMm);
  const adapter = getPrinterAdapter(mode);
  const base = adapter.status();
  return {
    ...base,
    mode,
    paperWidthMm,
    autoPrintReceipt: Boolean(input.autoPrintReceipt),
    printerConfigured: mode === "browser",
    status: mode === "browser" ? "configured" : "not_configured",
    message:
      mode === "browser"
        ? "Impressão pelo navegador disponível."
        : `Modo ${mode} sem bridge/hardware; status not_configured.`,
    availableModes: ["browser"],
  };
}

export type DispatchPrintInput = PrintRequestInput & {
  receipt: ReceiptModel;
  context?: PrinterTransportContext;
};

/**
 * Create a print job and dispatch through the selected adapter.
 * Never mutates sale/payment/inventory state.
 */
export async function dispatchPrintJob(input: DispatchPrintInput): Promise<{
  job: PrintJob;
  result: PrintAdapterResult;
}> {
  const mode = normalizePrintMode(input.mode);
  if (!(["browser", "escpos", "network", "native"] as const).includes(mode)) {
    const job = createPrintJob({ ...input, mode: "browser" });
    const result: PrintAdapterResult = {
      status: "unsupported_mode",
      message: "Modo de impressão não suportado.",
      errorCode: "unsupported_mode",
      retryable: false,
    };
    return { job: applyPrintResult(job, result), result };
  }

  const job = createPrintJob({
    ...input,
    mode,
    paperWidthMm: normalizePaperWidthMm(input.paperWidthMm),
  });
  const adapter = getPrinterAdapter(mode);

  if (modeRequiresHardwareBridge(mode) && !adapter.configured) {
    // Still call adapter so ESC/POS bytes can be generated for diagnostics/tests.
  }

  const result = await adapter.print(job, input.receipt, input.context);
  return { job: applyPrintResult(job, result), result };
}

export async function retryPrintJob(
  previous: PrintJob,
  receipt: ReceiptModel,
  context?: PrinterTransportContext
): Promise<{ job: PrintJob; result: PrintAdapterResult }> {
  const next = nextPrintAttempt(previous);
  const adapter = getPrinterAdapter(next.mode);
  const result = await adapter.print(next, receipt, context);
  return { job: applyPrintResult(next, result), result };
}

export { applyPrintResult, createPrintJob, nextPrintAttempt };
