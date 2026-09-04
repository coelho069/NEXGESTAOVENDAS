import {
  addInventoryQuantities,
  compareInventoryQuantities,
  toInventoryDelta,
  toInventoryQuantity,
  type QuantityInput,
} from "@/lib/domain/quantity";

export type InventoryCsvRow = {
  row: number;
  sku: string;
  delta: string;
  reason: string;
  movementType: "restock" | "adjustment";
};

export type CsvIssue = {
  row: number;
  sku?: string;
  message: string;
};

export type InventoryCsvResult = {
  rows: InventoryCsvRow[];
  errors: CsvIssue[];
};

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseInventoryCsv(text: string): InventoryCsvResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: [{ row: 0, message: "CSV vazio" }] };
  }

  const header = splitCsvLine(lines[0]!).map((cell) => cell.toLowerCase());
  const skuIdx = header.indexOf("sku");
  const deltaIdx = header.indexOf("delta");
  const reasonIdx = header.indexOf("reason");
  const typeIdx = header.indexOf("movement_type");

  if (skuIdx < 0 || deltaIdx < 0 || reasonIdx < 0 || typeIdx < 0) {
    return {
      rows: [],
      errors: [{ row: 1, message: "Cabeçalho obrigatório: sku,delta,reason,movement_type" }],
    };
  }

  const rows: InventoryCsvRow[] = [];
  const errors: CsvIssue[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const rowNumber = index + 1;
    const cells = splitCsvLine(lines[index]!);
    const sku = (cells[skuIdx] ?? "").trim();
    const reason = (cells[reasonIdx] ?? "").trim();
    const typeRaw = (cells[typeIdx] ?? "").trim().toLowerCase();
    const deltaRaw = (cells[deltaIdx] ?? "").trim().replace(",", ".");

    if (!sku) {
      errors.push({ row: rowNumber, message: "SKU obrigatório" });
      continue;
    }
    if (!reason) {
      errors.push({ row: rowNumber, sku, message: "Motivo obrigatório" });
      continue;
    }
    if (typeRaw !== "restock" && typeRaw !== "adjustment") {
      errors.push({ row: rowNumber, sku, message: "movement_type deve ser restock ou adjustment" });
      continue;
    }

    let delta: string;
    try {
      delta = toInventoryDelta(deltaRaw);
    } catch {
      errors.push({ row: rowNumber, sku, message: "Delta inválido (zero, escala ou limite)" });
      continue;
    }
    if (typeRaw === "restock" && compareInventoryQuantities(delta, "0.000") <= 0) {
      errors.push({ row: rowNumber, sku, message: "Restock exige delta positivo" });
      continue;
    }

    rows.push({ row: rowNumber, sku, delta, reason, movementType: typeRaw });
  }

  return { rows, errors };
}

export function toExportCsv(
  lines: Array<{
    sku: string;
    name: string;
    quantity: QuantityInput;
    unitPrice: string;
    costPrice?: string | null;
  }>
): string {
  const header = "sku,name,quantity,unit_price,cost_price";
  const body = lines.map((line) =>
    [
      line.sku,
      `"${line.name.replace(/"/g, '""')}"`,
      toInventoryQuantity(line.quantity),
      line.unitPrice,
      line.costPrice ?? "",
    ].join(",")
  );
  return [header, ...body].join("\n");
}

export function wouldGoNegative(currentQty: QuantityInput, delta: QuantityInput): boolean {
  try {
    addInventoryQuantities(currentQty, delta);
    return false;
  } catch {
    return true;
  }
}