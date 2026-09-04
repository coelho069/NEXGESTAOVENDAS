import { createHash } from "node:crypto";

export function inventoryImportMutationId(storeId: string, importId: string, row: number): string {
  const hex = createHash("sha256")
    .update(`nexgestao:inventory-import:${storeId}:${importId}:row:${row}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}
