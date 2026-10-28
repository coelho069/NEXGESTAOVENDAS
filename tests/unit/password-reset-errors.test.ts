import { describe, expect, it } from "vitest";
import { passwordResetErrorMessage } from "@/lib/domain/password-reset-errors";

describe("passwordResetErrorMessage", () => {
  it("explica os motivos conhecidos do Auth", () => {
    expect(passwordResetErrorMessage("same_password")).toMatch(/diferente da atual/);
    expect(passwordResetErrorMessage("weak_password")).toMatch(/maiúscula, minúscula, número e símbolo/);
    expect(passwordResetErrorMessage("reauthentication_needed")).toMatch(/inválido ou expirado/);
    expect(passwordResetErrorMessage({ status: 422, message: "Password should contain at least one character of each: abc" })).toMatch(/símbolo/);
    expect(passwordResetErrorMessage({ message: "Auth session missing!" })).toMatch(/Link inválido ou expirado/);
  });

  it("mapeia falha de rede e 5xx para mensagem de tentativa", () => {
    expect(passwordResetErrorMessage({ name: "AuthRetryableFetchError", status: 0 })).toMatch(/Falha de conexão/);
    expect(passwordResetErrorMessage({ status: 503, message: "x" })).toMatch(/Falha de conexão/);
  });

  it("trata usuário banido ou inexistente como link inválido", () => {
    expect(passwordResetErrorMessage("user_banned")).toMatch(/Link inválido/);
    expect(passwordResetErrorMessage("user_not_found")).toMatch(/Link inválido/);
  });

  it("mostra o código desconhecido para diagnóstico e usa a genérica sem código", () => {
    expect(passwordResetErrorMessage(undefined)).toBe("Não foi possível redefinir a senha. Peça um novo link.");
    expect(passwordResetErrorMessage("unexpected_failure")).toBe(
      "Não foi possível redefinir a senha (código: unexpected_failure). Peça um novo link."
    );
  });
});
