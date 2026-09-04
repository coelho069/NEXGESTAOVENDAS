-- Barcode identifiers are unique within an organization. NULL and blank
-- values remain available for products without a barcode.
CREATE UNIQUE INDEX products_org_barcode_key
ON public.products (org_id, lower(btrim(barcode)))
WHERE barcode IS NOT NULL AND btrim(barcode) <> '';
