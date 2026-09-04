export async function inventoryImportMutationIdBrowser(
  storeId: string,
  importId: string,
  row: number
): Promise<string> {
  const input = new TextEncoder().encode(
    `nexgestao:inventory-import:${storeId}:${importId}:row:${row}`
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}
