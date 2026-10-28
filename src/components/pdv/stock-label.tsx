import Decimal from "decimal.js";

type StockLabelProps = {
  productId: string;
  sku?: string;
  stockQty: number | undefined;
  cartQty: number;
};

function formatUnits(qty: Decimal): string {
  const normalized = qty.toDecimalPlaces(3);
  const asNumber = normalized.toNumber();
  const isInt = normalized.equals(normalized.toDecimalPlaces(0));
  const label = isInt
    ? String(normalized.toDecimalPlaces(0))
    : normalized.toString().replace(".", ",");
  if (isInt && asNumber === 1) return "1 un";
  return `${label} un`;
}

export function StockLabel({ productId, sku, stockQty, cartQty }: StockLabelProps) {
  if (stockQty === undefined) {
    return <span className="text-xs text-muted-foreground">Estoque —</span>;
  }
  // Decimal evita o lixo de ponto flutuante (ex.: 1.1 - 1 = 0.10000000000000009) com estoque fracionário.
  const projected = new Decimal(stockQty).minus(cartQty);
  const units = formatUnits(projected);
  const long =
    projected.equals(1) ? "Estoque: 1 unidade" : `Estoque: ${units.replace(" un", "")} unidades`;
  return (
    <span
      data-testid={`projected-stock-${sku ?? productId}`}
      title={long}
      className={projected.lte(0) ? "text-xs font-medium text-red-400" : "text-xs text-muted-foreground"}
    >
      Estoque projetado: {units}
    </span>
  );
}
