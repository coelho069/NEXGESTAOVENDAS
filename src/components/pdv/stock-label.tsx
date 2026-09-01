type StockLabelProps = {
  productId: string;
  sku?: string;
  stockQty: number | undefined;
  cartQty: number;
};

export function StockLabel({ productId, sku, stockQty, cartQty }: StockLabelProps) {
  if (stockQty === undefined) {
    return <span className="text-xs text-slate-400">Estoque —</span>;
  }
  const projected = stockQty - cartQty;
  return (
    <span
      data-testid={`projected-stock-${sku ?? productId}`}
      className={projected <= 0 ? "text-xs font-medium text-red-600" : "text-xs text-slate-500"}
    >
      Estoque projetado: {projected}
    </span>
  );
}