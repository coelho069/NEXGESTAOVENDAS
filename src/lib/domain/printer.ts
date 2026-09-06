/**
 * B25 — Thermal printing domain.
 *
 * Delivery semantics for physical hardware transports (ESC/POS / network / native):
 * **at-least-once**. A retry after a lost confirmation may produce a second physical copy.
 * Exactly-once is NOT claimed without an end-to-end hardware ACK.
 *
 * Browser print reaches `print_dispatched` after `window.print()` is invoked.
 * Physical success is never invented when no adapter transport exists.
 */

import type { ReceiptModel } from "@/lib/domain/receipt";
import { formatBRL } from "@/lib/money";
import { lineTotal } from "@/lib/domain/sale";
import { commercialReceiptDisclaimer, fiscalQrAvailability } from "@/lib/domain/fiscal";
import { fiscalStatusLabel } from "@/lib/domain/receipt";

export const PRINT_MODES = ["browser", "escpos", "network", "native"] as const;
export type PrintMode = (typeof PRINT_MODES)[number];

export const PAPER_WIDTHS_MM = [58, 80] as const;
export type PaperWidthMm = (typeof PAPER_WIDTHS_MM)[number];

export const PRINT_JOB_STATUSES = [
  "print_requested",
  "print_dispatched",
  "print_succeeded",
  "print_failed",
  "printer_not_configured",
  "printer_offline",
  "connection_failed",
  "timeout",
  "invalid_configuration",
  "unsupported_mode",
] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

/** Honest delivery guarantee for hardware paths. */
export const PRINT_DELIVERY_SEMANTICS = "at-least-once" as const;

export type PrintJob = {
  printJobId: string;
  saleId: string;
  storeId: string;
  orgId: string;
  attempt: number;
  mode: PrintMode;
  paperWidthMm: PaperWidthMm;
  status: PrintJobStatus;
  message: string;
  createdAt: string;
  updatedAt: string;
  /** Client mutation / idempotency key for this attempt. */
  idempotencyKey: string;
  errorCode?: string | null;
  retryable: boolean;
};

export type PrinterConfigView = {
  mode: PrintMode;
  paperWidthMm: PaperWidthMm;
  autoPrintReceipt: boolean;
  /** True only when the selected mode has a real transport available. */
  printerConfigured: boolean;
  status: PrintJobStatus | "configured" | "not_configured";
  message: string;
  availableModes: PrintMode[];
  deliverySemantics: typeof PRINT_DELIVERY_SEMANTICS;
};

export type PrintRequestInput = {
  saleId: string;
  storeId: string;
  orgId: string;
  mode: PrintMode;
  paperWidthMm: PaperWidthMm;
  attempt?: number;
  printJobId?: string;
  idempotencyKey?: string;
  /** When true, skip auto-print if previous attempt for sale already dispatched. */
  autoPrint?: boolean;
};

export type PrintAdapterResult = {
  status: PrintJobStatus;
  message: string;
  errorCode?: string;
  retryable: boolean;
  /** Raw ESC/POS bytes when generated (never implies hardware delivery). */
  payload?: Uint8Array;
};

export function isPrintMode(value: unknown): value is PrintMode {
  return typeof value === "string" && (PRINT_MODES as readonly string[]).includes(value);
}

export function isPaperWidthMm(value: unknown): value is PaperWidthMm {
  return value === 58 || value === 80;
}

export function normalizePrintMode(value: unknown): PrintMode {
  return isPrintMode(value) ? value : "browser";
}

export function normalizePaperWidthMm(value: unknown): PaperWidthMm {
  if (value === 58 || value === "58") return 58;
  return 80;
}

export function paperWidthCssMm(width: PaperWidthMm): number {
  return width;
}

export function createPrintJobId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `print-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createPrintJob(input: PrintRequestInput): PrintJob {
  const now = new Date().toISOString();
  const printJobId = input.printJobId ?? createPrintJobId();
  const attempt = input.attempt && input.attempt > 0 ? Math.floor(input.attempt) : 1;
  return {
    printJobId,
    saleId: input.saleId,
    storeId: input.storeId,
    orgId: input.orgId,
    attempt,
    mode: normalizePrintMode(input.mode),
    paperWidthMm: normalizePaperWidthMm(input.paperWidthMm),
    status: "print_requested",
    message: "Impressão solicitada",
    createdAt: now,
    updatedAt: now,
    idempotencyKey: input.idempotencyKey ?? `${input.saleId}:${attempt}`,
    errorCode: null,
    retryable: true,
  };
}

export function applyPrintResult(job: PrintJob, result: PrintAdapterResult): PrintJob {
  return {
    ...job,
    status: result.status,
    message: result.message,
    errorCode: result.errorCode ?? null,
    retryable: result.retryable,
    updatedAt: new Date().toISOString(),
  };
}

export function isTerminalPrintFailure(status: PrintJobStatus): boolean {
  return (
    status === "print_failed" ||
    status === "printer_not_configured" ||
    status === "printer_offline" ||
    status === "connection_failed" ||
    status === "timeout" ||
    status === "invalid_configuration" ||
    status === "unsupported_mode"
  );
}

export function isPrintSuccessOrDispatched(status: PrintJobStatus): boolean {
  return status === "print_succeeded" || status === "print_dispatched";
}

/**
 * Print failure must never mutate sale / payment / inventory state.
 * This helper documents the invariant for callers and tests.
 */
export function printFailureAffectsSaleLifecycle(): false {
  return false;
}

export function nextPrintAttempt(job: PrintJob): PrintJob {
  const attempt = job.attempt + 1;
  const now = new Date().toISOString();
  return {
    ...job,
    printJobId: createPrintJobId(),
    attempt,
    status: "print_requested",
    message: `Nova tentativa de impressão (#${attempt})`,
    createdAt: now,
    updatedAt: now,
    idempotencyKey: `${job.saleId}:${attempt}`,
    errorCode: null,
    retryable: true,
  };
}

/** Modes that require a hardware/native bridge which is not present in this web runtime. */
export function modeRequiresHardwareBridge(mode: PrintMode): boolean {
  return mode === "escpos" || mode === "network" || mode === "native";
}

export function defaultPrinterConfigView(input: {
  mode?: PrintMode;
  paperWidthMm?: PaperWidthMm;
  autoPrintReceipt?: boolean;
  browserAvailable?: boolean;
}): PrinterConfigView {
  const mode = normalizePrintMode(input.mode);
  const browserAvailable = input.browserAvailable !== false;
  const availableModes: PrintMode[] = browserAvailable ? ["browser"] : [];
  const printerConfigured = mode === "browser" && browserAvailable;
  return {
    mode,
    paperWidthMm: normalizePaperWidthMm(input.paperWidthMm),
    autoPrintReceipt: Boolean(input.autoPrintReceipt),
    printerConfigured,
    status: printerConfigured ? "configured" : "not_configured",
    message: printerConfigured
      ? "Impressão pelo navegador disponível."
      : modeRequiresHardwareBridge(mode)
        ? `Modo ${mode} sem bridge/hardware seguro; impressora não configurada.`
        : "Nenhuma impressora configurada.",
    availableModes,
    deliverySemantics: PRINT_DELIVERY_SEMANTICS,
  };
}

/**
 * Reject arbitrary host/port (SSRF). Network printing must go through a local
 * secure bridge — never open server sockets to client-supplied destinations.
 */
export function validateNetworkPrinterDestination(
  host: unknown,
  port: unknown
):
  | { ok: true; host: string; port: number }
  | { ok: false; code: "invalid_configuration"; message: string } {
  if (typeof host !== "string" || !host.trim()) {
    return { ok: false, code: "invalid_configuration", message: "Host de impressora inválido." };
  }
  const trimmed = host.trim().toLowerCase();
  if (trimmed.length > 253) {
    return { ok: false, code: "invalid_configuration", message: "Host de impressora inválido." };
  }
  // Block credentials-in-URL, schemes, paths, and userinfo.
  if (
    trimmed.includes("://") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("@") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    trimmed.includes(" ")
  ) {
    return { ok: false, code: "invalid_configuration", message: "Host de impressora inválido." };
  }
  // Block cloud metadata and common SSRF targets.
  const blockedHosts = new Set([
    "localhost",
    "metadata.google.internal",
    "metadata",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "[::1]",
  ]);
  if (blockedHosts.has(trimmed)) {
    return { ok: false, code: "invalid_configuration", message: "Host de impressora não permitido." };
  }
  // IPv4 literal: validate shape, then always reject server-side connect.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(trimmed);
  if (ipv4) {
    const octets = ipv4.slice(1).map((part) => Number(part));
    if (octets.some((n) => n > 255)) {
      return { ok: false, code: "invalid_configuration", message: "Host de impressora inválido." };
    }
  } else if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(trimmed)
  ) {
    return { ok: false, code: "invalid_configuration", message: "Host de impressora inválido." };
  }

  const portNum = typeof port === "number" ? port : Number(port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return { ok: false, code: "invalid_configuration", message: "Porta de impressora inválida." };
  }
  // Well-known dangerous / system ports
  if (portNum === 22 || portNum === 23 || portNum === 25 || portNum === 445 || portNum === 3389) {
    return { ok: false, code: "invalid_configuration", message: "Porta de impressora não permitida." };
  }

  // Server never accepts client-supplied destinations for outbound connect.
  // LAN/USB printing requires a local secure bridge — not an arbitrary server socket.
  return {
    ok: false,
    code: "invalid_configuration",
    message: "Destino de rede não aceito pelo servidor; use bridge local seguro (não configurado).",
  };
}

/**
 * Refuse shell/exec-style payloads. Printer adapters must never exec user input.
 */
export function assertNoShellPrinterCommand(command: unknown): void {
  if (typeof command === "string") {
    const dangerous =
      /[;&|`$<>]|\b(?:sh|bash|cmd|powershell|exec|spawn|system)\b/i.test(command);
    if (dangerous) {
      throw new Error("shell_injection_rejected");
    }
  }
}

export function rejectShellPrinterExecution(userInput: string): never {
  void userInput;
  throw new Error("shell_injection_rejected");
}

// —— ESC/POS command generation (pure; no I/O) ————————————————————————————

export const ESC = 0x1b;
export const GS = 0x1d;
export const LF = 0x0a;

export type EscPosAlign = "left" | "center" | "right";

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytesOf(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

/** Encode text as CP850-ish Latin fallback: keep ASCII; map common PT accents. */
export function encodeEscPosText(text: string): Uint8Array {
  const map: Record<string, number> = {
    Á: 0xb5,
    À: 0xb7,
    Ã: 0xc7,
    Â: 0xb6,
    É: 0x90,
    Ê: 0xd2,
    Í: 0xd6,
    Ó: 0xe0,
    Ô: 0xe2,
    Õ: 0xe5,
    Ú: 0xe9,
    Ü: 0x9a,
    Ç: 0x80,
    á: 0xa0,
    à: 0x85,
    ã: 0xc6,
    â: 0x83,
    é: 0x82,
    ê: 0x88,
    í: 0xa1,
    ó: 0xa2,
    ô: 0x93,
    õ: 0xe4,
    ú: 0xa3,
    ü: 0x81,
    ç: 0x87,
    º: 0xa7,
    ª: 0xa6,
    "°": 0xf8,
  };
  const out: number[] = [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      out.push(code);
      continue;
    }
    if (char === "\n") {
      out.push(LF);
      continue;
    }
    const mapped = map[char];
    if (mapped != null) {
      out.push(mapped);
      continue;
    }
    out.push(0x3f); // ?
  }
  return Uint8Array.from(out);
}

export function escPosInit(): Uint8Array {
  return bytesOf(ESC, 0x40);
}

export function escPosAlign(align: EscPosAlign): Uint8Array {
  const n = align === "center" ? 1 : align === "right" ? 2 : 0;
  return bytesOf(ESC, 0x61, n);
}

export function escPosBold(on: boolean): Uint8Array {
  return bytesOf(ESC, 0x45, on ? 1 : 0);
}

export function escPosText(text: string): Uint8Array {
  return encodeEscPosText(text);
}

export function escPosFeed(lines = 1): Uint8Array {
  const n = Math.max(0, Math.min(20, Math.floor(lines)));
  return bytesOf(ESC, 0x64, n);
}

export function escPosCut(partial = false): Uint8Array {
  return bytesOf(GS, 0x56, partial ? 1 : 0);
}

/** QR model 2 — only when payload is non-empty and length is within ESC/POS limits. */
export function escPosQr(data: string): Uint8Array | null {
  if (!data || data.length > 7089) return null;
  const payload = encodeEscPosText(data);
  const storeLen = payload.length + 3;
  const pL = storeLen & 0xff;
  const pH = (storeLen >> 8) & 0xff;
  return concatBytes(
    bytesOf(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00), // model 2
    bytesOf(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x08), // size
    bytesOf(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30), // EC level L
    bytesOf(GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30),
    payload,
    bytesOf(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30)
  );
}

/** CODE128 barcode when content is printable ASCII and short enough. */
export function escPosBarcode(data: string): Uint8Array | null {
  if (!data || data.length > 64 || !/^[\x20-\x7e]+$/.test(data)) return null;
  const payload = encodeEscPosText(data);
  return concatBytes(
    bytesOf(GS, 0x68, 0x50), // height
    bytesOf(GS, 0x77, 0x02), // width
    bytesOf(GS, 0x48, 0x02), // HRI below
    bytesOf(GS, 0x6b, 0x49, payload.length),
    payload,
    bytesOf(LF)
  );
}

export function charsPerLine(width: PaperWidthMm): number {
  return width === 58 ? 32 : 48;
}

export function wrapEscPosLine(text: string, width: PaperWidthMm): string[] {
  const max = charsPerLine(width);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word.slice(0, max);
      if (word.length > max) {
        lines.push(current);
        let rest = word.slice(max);
        while (rest.length > max) {
          lines.push(rest.slice(0, max));
          rest = rest.slice(max);
        }
        current = rest;
      }
      continue;
    }
    if (`${current} ${word}`.length <= max) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word.slice(0, max);
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/**
 * Build a commercial ESC/POS receipt payload.
 * Never invents fiscal authorization / QR / access key.
 */
export function buildEscPosReceipt(
  model: ReceiptModel,
  paperWidthMm: PaperWidthMm = 80
): Uint8Array {
  const parts: Uint8Array[] = [escPosInit(), escPosAlign("center"), escPosBold(true)];
  const title =
    model.documentKind === "cancelamento"
      ? "CANCELAMENTO"
      : model.documentKind === "devolucao"
        ? "DEVOLUCAO"
        : "COMPROVANTE COMERCIAL";
  parts.push(escPosText(`${title}\n`));
  parts.push(escPosBold(false));
  parts.push(escPosText(`${model.storeName}\n`));
  parts.push(escPosAlign("left"));

  const pushLines = (text: string) => {
    for (const line of wrapEscPosLine(text, paperWidthMm)) {
      parts.push(escPosText(`${line}\n`));
    }
  };

  if (model.storeDocument) pushLines(`Doc. ${model.storeDocument}`);
  if (model.storePhone) pushLines(`Tel. ${model.storePhone}`);
  if (model.storeAddress) pushLines(model.storeAddress);
  pushLines(`Venda ${model.saleId}`);
  if (model.operatorName) pushLines(`Operador: ${model.operatorName}`);
  pushLines(`Cliente: ${model.customerName ?? "Nao informado"}`);
  parts.push(escPosText(`${"-".repeat(charsPerLine(paperWidthMm))}\n`));

  for (const line of model.lines) {
    pushLines(`${line.sku} ${line.name}`);
    pushLines(
      `${line.quantity} x ${formatBRL(line.unitPrice)} = ${formatBRL(lineTotal(line))}`
    );
  }

  parts.push(escPosText(`${"-".repeat(charsPerLine(paperWidthMm))}\n`));
  pushLines(`Subtotal ${formatBRL(model.subtotal)}`);
  pushLines(`Desconto ${formatBRL(model.discount)}`);
  parts.push(escPosBold(true));
  pushLines(`Total ${formatBRL(model.total)}`);
  parts.push(escPosBold(false));

  for (const payment of model.payments) {
    pushLines(`${payment.method} ${formatBRL(payment.amount)} ${payment.status}`);
  }
  if (model.amountReceived) pushLines(`Recebido ${formatBRL(model.amountReceived)}`);
  if (model.changeDue) pushLines(`Troco ${formatBRL(model.changeDue)}`);

  const fiscalStatus = model.fiscalStatus ?? "pending";
  pushLines(commercialReceiptDisclaimer(fiscalStatus));
  pushLines(
    `Fiscal: ${fiscalStatusLabel(fiscalStatus)}${
      model.fiscalKind ? ` · ${model.fiscalKind.toUpperCase()}` : ""
    }`
  );

  const qr = fiscalQrAvailability({
    status: fiscalStatus,
    accessKey: model.fiscalAccessKey,
    protocol: model.fiscalProtocol,
  });
  if (qr.available) {
    parts.push(escPosAlign("center"));
    const qrBytes = escPosQr(qr.accessKey);
    if (qrBytes) parts.push(qrBytes);
    parts.push(escPosText(`\nChave ${qr.accessKey}\n`));
    parts.push(escPosAlign("left"));
  } else {
    pushLines(qr.reason);
  }

  const barcode = escPosBarcode(model.saleId.replace(/[^0-9A-Za-z-]/g, "").slice(0, 32));
  if (barcode) {
    parts.push(escPosAlign("center"), barcode, escPosAlign("left"));
  }

  if (model.receiptFooter) pushLines(model.receiptFooter);
  parts.push(escPosFeed(3), escPosCut(false));
  return concatBytes(...parts);
}

export function printStatusLabel(status: PrintJobStatus | "configured" | "not_configured"): string {
  switch (status) {
    case "print_requested":
      return "solicitada";
    case "print_dispatched":
      return "enviada";
    case "print_succeeded":
      return "sucesso";
    case "print_failed":
      return "falhou";
    case "printer_not_configured":
    case "not_configured":
      return "não configurada";
    case "configured":
      return "configurada";
    case "printer_offline":
      return "offline";
    case "connection_failed":
      return "falha de conexão";
    case "timeout":
      return "timeout";
    case "invalid_configuration":
      return "configuração inválida";
    case "unsupported_mode":
      return "modo não suportado";
  }
}
