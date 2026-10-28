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
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);
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
