import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginForm } from "@/components/auth/login-form";

const { mockReplace, mockRefresh, mockSignInWithPassword, mockCreateClient } = vi.hoisted(() => {
  const mockReplace = vi.fn();
  const mockRefresh = vi.fn();
  const mockSignInWithPassword = vi.fn();
  const mockCreateClient = vi.fn(() => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
    },
  }));
  return { mockReplace, mockRefresh, mockSignInWithPassword, mockCreateClient };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    refresh: mockRefresh,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mockCreateClient,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoginForm unit tests", () => {
  it("1. Fields render: email input type=email and required, password input type=password and required", () => {
    render(<LoginForm />);
    const emailInput = screen.getByPlaceholderText("seu@email.com") as HTMLInputElement;
    const passwordInput = screen.getByPlaceholderText("••••••••") as HTMLInputElement;

    expect(emailInput).toBeInTheDocument();
    expect(emailInput.type).toBe("email");
    expect(emailInput.required).toBe(true);

    expect(passwordInput).toBeInTheDocument();
    expect(passwordInput.type).toBe("password");
    expect(passwordInput.required).toBe(true);
  });

  it("2. HTML5 validity: empty or malformed email is invalid, valid email and password are valid", () => {
    render(<LoginForm />);
    const emailInput = screen.getByPlaceholderText("seu@email.com") as HTMLInputElement;
    const passwordInput = screen.getByPlaceholderText("••••••••") as HTMLInputElement;

    // Initially empty -> invalid
    expect(emailInput.checkValidity()).toBe(false);

    // Malformed email
    fireEvent.change(emailInput, { target: { value: "invalid-email" } });
    fireEvent.change(passwordInput, { target: { value: "secret123" } });
    expect(emailInput.checkValidity()).toBe(false);

    // Valid email and password
    fireEvent.change(emailInput, { target: { value: "operator@loja.com" } });
    expect(emailInput.checkValidity()).toBe(true);
    expect(passwordInput.checkValidity()).toBe(true);
  });

  it("3. The typed password never appears as text on the page", () => {
    render(<LoginForm />);
    const passwordInput = screen.getByPlaceholderText("••••••••");
    const secretPassword = "SuperSecretPassword123!";

    fireEvent.change(passwordInput, { target: { value: secretPassword } });
    expect(screen.queryByText(secretPassword)).toBeNull();
  });

  it("4. Success: signInWithPassword is called with exact typed values, replace and refresh are called, no error", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({ error: null });

    render(<LoginForm />);
    const emailInput = screen.getByPlaceholderText("seu@email.com");
    const passwordInput = screen.getByPlaceholderText("••••••••");
    const submitBtn = screen.getByRole("button", { name: "Entrar" });

    fireEvent.change(emailInput, { target: { value: "cashier@loja.com" } });
    fireEvent.change(passwordInput, { target: { value: "correctpassword" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: "cashier@loja.com",
        password: "correctpassword",
      });
      expect(mockReplace).toHaveBeenCalledWith("/pdv");
      expect(mockRefresh).toHaveBeenCalled();
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("5. Wrong credentials: generic error appears, no navigation, error text does not contain typed password", async () => {
    const wrongPassword = "mysecretbadpassword";
    mockSignInWithPassword.mockResolvedValueOnce({
      error: { message: "Invalid login credentials" },
    });

    render(<LoginForm />);
    const emailInput = screen.getByPlaceholderText("seu@email.com");
    const passwordInput = screen.getByPlaceholderText("••••••••");
    const submitBtn = screen.getByRole("button", { name: "Entrar" });

    fireEvent.change(emailInput, { target: { value: "test@loja.com" } });
    fireEvent.change(passwordInput, { target: { value: wrongPassword } });
    fireEvent.click(submitBtn);

    const alertEl = await screen.findByRole("alert");
    expect(alertEl).toHaveTextContent("Credenciais inválidas ou sessão indisponível.");
    expect(alertEl.textContent).not.toContain(wrongPassword);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("6. Injection payload in password (' OR '1'='1): passed as plain parameter, does not log in successfully", async () => {
    const sqlInjectionPassword = "' OR '1'='1";
    mockSignInWithPassword.mockResolvedValueOnce({
      error: { message: "Invalid login credentials" },
    });

    render(<LoginForm />);
    const emailInput = screen.getByPlaceholderText("seu@email.com");
    const passwordInput = screen.getByPlaceholderText("••••••••");
    const submitBtn = screen.getByRole("button", { name: "Entrar" });

    fireEvent.change(emailInput, { target: { value: "admin@loja.com" } });
    fireEvent.change(passwordInput, { target: { value: sqlInjectionPassword } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: "admin@loja.com",
        password: sqlInjectionPassword,
      });
      expect(mockReplace).not.toHaveBeenCalled();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Credenciais inválidas ou sessão indisponível.");
  });

  it("7. Injection payload in email (admin'--@loja.com): does not log in successfully", async () => {
    const sqlInjectionEmail = "admin'--@loja.com";
    mockSignInWithPassword.mockResolvedValueOnce({
      error: { message: "Invalid login credentials" },
    });

    render(<LoginForm />);
    const emailInput = screen.getByPlaceholderText("seu@email.com");
    const passwordInput = screen.getByPlaceholderText("••••••••");
    const submitBtn = screen.getByRole("button", { name: "Entrar" });

    fireEvent.change(emailInput, { target: { value: sqlInjectionEmail } });
    fireEvent.change(passwordInput, { target: { value: "somepass" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: sqlInjectionEmail,
        password: "somepass",
      });
      expect(mockReplace).not.toHaveBeenCalled();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Credenciais inválidas ou sessão indisponível.");
  });

  it("8. REGRESSION TEST FOR THIS BUG: createClient throws missing env error, generic error appears and button is back to enabled with text 'Entrar'", async () => {
    mockCreateClient.mockImplementationOnce(() => {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    });

    render(<LoginForm />);
    const emailInput = screen.getByPlaceholderText("seu@email.com");
    const passwordInput = screen.getByPlaceholderText("••••••••");
    const submitBtn = screen.getByRole("button", { name: "Entrar" });

    fireEvent.change(emailInput, { target: { value: "test@loja.com" } });
    fireEvent.change(passwordInput, { target: { value: "password123" } });
    fireEvent.click(submitBtn);

    const alertEl = await screen.findByRole("alert");
    expect(alertEl).toHaveTextContent("Credenciais inválidas ou sessão indisponível.");

    const button = screen.getByRole("button", { name: "Entrar" });
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("Entrar");

    // Reset mockCreateClient for subsequent tests
    mockCreateClient.mockImplementation(() => ({
      auth: {
        signInWithPassword: mockSignInWithPassword,
      },
    }));
  });

  it("9. While the sign-in promise is pending, the button is disabled with the text 'Entrando...'", async () => {
    let resolveSignIn: (value: { error: { message: string } | null }) => void = () => {};
    const signInPromise = new Promise((resolve) => {
      resolveSignIn = resolve as (value: { error: { message: string } | null }) => void;
    });
    mockSignInWithPassword.mockReturnValueOnce(signInPromise);

    render(<LoginForm />);
    const emailInput = screen.getByPlaceholderText("seu@email.com");
    const passwordInput = screen.getByPlaceholderText("••••••••");
    const submitBtn = screen.getByRole("button", { name: "Entrar" });

    fireEvent.change(emailInput, { target: { value: "test@loja.com" } });
    fireEvent.change(passwordInput, { target: { value: "password123" } });
    fireEvent.click(submitBtn);

    const loadingBtn = screen.getByRole("button", { name: "Entrando..." });
    expect(loadingBtn).toBeDisabled();

    resolveSignIn({ error: null });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
    });
  });
});
