import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PHASE21_AUDIT_BUTTON_LABEL,
  phase21AuditPassed,
  runPhase21BehaviorChecks,
  runPhase21SourceChecks,
} from "@/lib/domain/refund-phase21-audit";

const mocks = vi.hoisted(() => ({
  runPhase21AuditAction: vi.fn(),
}));

vi.mock("@/lib/server/refund-phase21-audit-action", () => ({
  runPhase21AuditAction: mocks.runPhase21AuditAction,
}));

import { Phase21AuditButton } from "@/components/admin/phase21-audit-button";

const SOURCE_FILES = [
  "src/app/api/refund-requests/route.ts",
  "src/lib/server/refund-requests.ts",
  "src/lib/domain/refund-request.ts",
  "src/lib/server/refund-phase21-audit-action.ts",
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("phase 2.1 safe audit", () => {
  it("passes behavior and source checks without calling the network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const files = Object.fromEntries(
      SOURCE_FILES.map((path) => [path, readFileSync(join(process.cwd(), path), "utf8")])
    );
    const checks = [...runPhase21BehaviorChecks(), ...runPhase21SourceChecks(files)];
    expect(phase21AuditPassed(checks)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("shows the phase 2.1 button and does not run until clicked", () => {
    render(<Phase21AuditButton />);
    expect(screen.getByRole("button", { name: PHASE21_AUDIT_BUTTON_LABEL })).toBeInTheDocument();
    expect(mocks.runPhase21AuditAction).not.toHaveBeenCalled();
  });

  it("lists safe check results after the click", async () => {
    mocks.runPhase21AuditAction.mockResolvedValue({
      ok: true,
      passed: true,
      checks: [
        {
          id: "provider_refund_disabled",
          status: "pass",
          detail: "O estorno no provedor permanece desligado.",
        },
      ],
    });
    render(<Phase21AuditButton />);
    fireEvent.click(screen.getByRole("button", { name: PHASE21_AUDIT_BUTTON_LABEL }));
    expect(await screen.findByRole("status")).toHaveTextContent("Verificações seguras passaram.");
    expect(screen.getByText(/O estorno no provedor permanece desligado/)).toBeInTheDocument();
  });
});
