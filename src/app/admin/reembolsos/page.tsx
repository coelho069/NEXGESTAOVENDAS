import { AdminRefundRequestsScreen } from "@/components/admin/admin-refund-requests-screen";
import { accountBalanceNotice } from "@/lib/domain/account-balance-notice";
import { refundSandboxProcessingEnabled } from "@/lib/domain/refund-sandbox-mode";
import {
  loadApprovedUnsentOutstanding,
  loadRefundRequests,
  loadRefundSandboxPresentation,
} from "@/lib/server/admin-refund-requests-query";

export const dynamic = "force-dynamic";

export default async function AdminRefundRequestsPage() {
  const result = await loadRefundRequests();
  const approvedUnsentCount = (result.data ?? []).filter(
    (row) => row.status === "approved" && row.provider_refund_status === "not_sent"
  ).length;
  const outstanding = approvedUnsentCount > 0 ? await loadApprovedUnsentOutstanding(result.data ?? []) : null;
  const sandboxEnabled = refundSandboxProcessingEnabled(process.env);
  const sandbox = sandboxEnabled && result.data ? await loadRefundSandboxPresentation(result.data) : null;
  return (
    <AdminRefundRequestsScreen
      data={result.data}
      error={result.error}
      balanceNotice={accountBalanceNotice({ approvedUnsentCount, outstanding })}
      sandboxEnabled={sandboxEnabled}
      sandbox={sandbox}
    />
  );
}
