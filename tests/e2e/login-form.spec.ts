import { test, expect } from "@playwright/test";

test.describe("Login Form E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("1. Fields visible with correct types and required attributes", async ({ page }) => {
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');

    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute("required", "");
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute("required", "");
  });

  test("2. Empty submit stays on /login (native validation)", async ({ page }) => {
    const submitBtn = page.getByRole("button", { name: "Entrar" });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("3. Malformed email blocked (validity.typeMismatch is true)", async ({ page }) => {
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.getByRole("button", { name: "Entrar" });

    await emailInput.fill("notanemail");
    await passwordInput.fill("somepassword");
    await submitBtn.click();

    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.checkValidity() && el.validity.typeMismatch);
    expect(isInvalid).toBe(true);
    await expect(page).toHaveURL(/\/login/);
  });

  test("4. Wrong credentials: generic error visible, Entrar button enabled again, stays on /login", async ({ page }) => {
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.getByRole("button", { name: "Entrar" });

    await emailInput.fill("cashier@loja.com");
    await passwordInput.fill("wrongpassword");
    await submitBtn.click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Credenciais inválidas ou sessão indisponível.");

    await expect(submitBtn).toBeEnabled();
    await expect(submitBtn).toHaveText("Entrar");
    await expect(page).toHaveURL(/\/login/);
  });

  test("5. Injection payload in the password: generic error visible, stays on /login", async ({ page }) => {
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.getByRole("button", { name: "Entrar" });

    await emailInput.fill("cashier@loja.com");
    await passwordInput.fill("' OR '1'='1");
    await submitBtn.click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Credenciais inválidas ou sessão indisponível.");
    await expect(page).toHaveURL(/\/login/);
  });

  test("6. XSS payload in the email: no dialog opens, stays on /login", async ({ page }) => {
    let dialogOpened = false;
    page.on("dialog", () => {
      dialogOpened = true;
    });

    const emailInput = page.locator('input[type="email"]');
    const submitBtn = page.getByRole("button", { name: "Entrar" });

    await emailInput.evaluate((el: HTMLInputElement) => {
      el.value = "<script>alert('xss')</script>";
    });
    await submitBtn.click();

    expect(dialogOpened).toBe(false);
    await expect(page).toHaveURL(/\/login/);
  });
});
