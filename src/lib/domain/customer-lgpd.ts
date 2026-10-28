/**
 * Helpers for store operators handling LGPD data-subject requests on customer records.
 * Anonymization clears direct identifiers while keeping the row for sales history integrity.
 */

export const ANONYMIZED_CUSTOMER_NAME = "Cliente anonimizado";

export function isAnonymizedCustomerName(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === ANONYMIZED_CUSTOMER_NAME.toLowerCase();
}

export function buildAnonymizedCustomerPatch(): {
  name: string;
  document: null;
  email: null;
} {
  return {
    name: ANONYMIZED_CUSTOMER_NAME,
    document: null,
    email: null,
  };
}

export type CustomerLgpdExportPayload = {
  exported_at: string;
  purpose: "lgpd_data_subject_export";
  notice: string;
  customer: {
    id: string;
    name: string;
    document: string | null;
    email: string | null;
    discount_limit?: string | null;
  };
  sales: unknown;
};
