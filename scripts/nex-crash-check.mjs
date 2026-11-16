import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox"] });
const page = await browser.newPage();
const errors = [];
const consoleMsgs = [];
page.on("pageerror", (e) => errors.push(String(e.stack || e)));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleMsgs.push(msg.text());
});
page.on("response", (r) => {
  if (r.url().includes("/_next/") && r.status() >= 400) consoleMsgs.push(`BAD ${r.status()} ${r.url()}`);
});
for (const url of ["https://nexgestaovendas.com.br/", "https://nexgestaovendas.com.br/login", "https://nexgestaovendas.com.br/pdv", "https://nexgestaovendas.com.br/politica-de-privacidade", "https://nexgestaovendas.com.br/clientes", "https://nexgestaovendas.com.br/configuracoes"]) {
  errors.length = 0; consoleMsgs.length = 0;
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Measure user-perceived time (c): time until main content visible, not networkidle
    const cStart = Date.now();
    try { await page.getByTestId("pdv-layout").waitFor({ state: "visible", timeout: 15000 }); } catch {}
    try { await page.getByRole("heading", { level: 1 }).first().waitFor({ state: "visible", timeout: 5000 }); } catch {}
    const cMs = Date.now() - cStart;
    console.log(`[c] visible content wait ${cMs}ms for ${url}`);
    await page.waitForTimeout(500);
    const body = await page.locator("body").innerText().catch(()=>"");
    const hasAppError = body.includes("Application error") || body.includes("client-side exception");
    console.log("---", url, "status", res?.status(), "appError", hasAppError);
    console.log("pageerrors:", errors.slice(0,3).join("\n---\n") || "(none)");
    console.log("console:", consoleMsgs.slice(0,10).join(" | ") || "(none)");
    if (hasAppError) console.log("body snippet:", JSON.stringify(body.slice(0,400)));
  } catch (e) {
    console.log("---", url, "GOTO FAIL", String(e).slice(0,300));
  }
}
await browser.close();
