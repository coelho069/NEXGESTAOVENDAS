import { execFileSync, execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SCRIPT = resolve(process.cwd(), "scripts/nex-atomic-deploy-check.sh");

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "nex-atomic-deploy-"));
}

function writeStandalone(
  root: string,
  opts: {
    serverJs?: boolean;
    staticFiles?: Record<string, string>;
    html?: string;
  },
): void {
  const standalone = join(root, ".next", "standalone");
  mkdirSync(standalone, { recursive: true });
  if (opts.serverJs !== false) {
    writeFileSync(join(standalone, "server.js"), "/* fixture */\n");
  }
  if (opts.staticFiles) {
    for (const [rel, body] of Object.entries(opts.staticFiles)) {
      const dest = join(standalone, ".next", "static", rel);
      mkdirSync(join(dest, ".."), { recursive: true });
      writeFileSync(dest, body);
    }
  }
  if (opts.html) {
    const htmlPath = join(standalone, ".next", "server", "app", "index.html");
    mkdirSync(join(htmlPath, ".."), { recursive: true });
    writeFileSync(htmlPath, opts.html);
  }
}

function runCheck(
  root: string,
  extraArgs: string[] = [],
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bash", [SCRIPT, "--root", root, ...extraArgs], {
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: typeof err.status === "number" ? err.status : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("nex-atomic-deploy-check.sh", () => {
  it("fails loudly when standalone static is missing (#5/#8)", () => {
    const root = makeRoot();
    roots.push(root);
    writeStandalone(root, { serverJs: true });

    const result = runCheck(root);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(
      /ATOMIC DEPLOY CHECK FAILED/,
    );
    expect(`${result.stdout}${result.stderr}`).toMatch(/#5\/#8|static/i);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/PASSED/);
  });

  it("fails when static dir exists but has zero files", () => {
    const root = makeRoot();
    roots.push(root);
    writeStandalone(root, { serverJs: true });
    mkdirSync(join(root, ".next", "standalone", ".next", "static"), {
      recursive: true,
    });

    const result = runCheck(root);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/0 files|#5\/#8/);
  });

  it("fails when server.js is missing", () => {
    const root = makeRoot();
    roots.push(root);
    writeStandalone(root, {
      serverJs: false,
      staticFiles: {
        "css/app.css": "body{}",
        "chunks/main-app.js": "/* main-app */",
      },
    });

    const result = runCheck(root);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/server\.js/);
  });

  it("fails when HTML references a chunk that is not on disk", () => {
    const root = makeRoot();
    roots.push(root);
    writeStandalone(root, {
      staticFiles: {
        "css/app.css": "body{}",
        "chunks/main-app.js": "/* main-app */",
      },
      html: '<link href="/_next/static/css/missing.css" rel="stylesheet"/>',
    });

    const result = runCheck(root);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(
      /ATOMIC DEPLOY CHECK FAILED/,
    );
    expect(`${result.stdout}${result.stderr}`).toMatch(/missing\.css|#5\/#8/);
  });

  it("passes when css + main-app chunks exist", () => {
    const root = makeRoot();
    roots.push(root);
    writeStandalone(root, {
      staticFiles: {
        "css/app.css": "body{color:#111}",
        "chunks/main-app-abc.js": "/* main-app */",
      },
    });

    const result = runCheck(root);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/PASSED/);
  });

  it("passes when built HTML refs resolve on disk", () => {
    const root = makeRoot();
    roots.push(root);
    writeStandalone(root, {
      staticFiles: {
        "css/app.css": "body{}",
        "chunks/main-app-abc.js": "/* main-app */",
      },
      html: [
        '<link href="/_next/static/css/app.css" rel="stylesheet"/>',
        '<script src="/_next/static/chunks/main-app-abc.js"></script>',
      ].join("\n"),
    });

    const result = runCheck(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/HTML\/RSC static references exist/);
  });

  it("strips a trailing backslash from escaped HTML/RSC static refs", () => {
    const root = makeRoot();
    roots.push(root);
    writeStandalone(root, {
      staticFiles: {
        "css/app.css": "body{}",
        "chunks/main-app-abc.js": "/* main-app */",
        "media/font.woff2": "font",
      },
      // Escaped quotes (RSC/JSON) leave a trailing \ on grep -oE matches.
      html: [
        'href=\\"/_next/static/css/app.css\\"',
        'src=\\"/_next/static/chunks/main-app-abc.js\\"',
        'url(\\/_next/static/media/font.woff2\\)',
      ].join("\n"),
    });

    const result = runCheck(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/HTML\/RSC static references exist/);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(
      /ATOMIC DEPLOY CHECK FAILED/,
    );
  });

  it("fails readiness gate when the process is not listening", async () => {
    const root = makeRoot();
    roots.push(root);
    writeStandalone(root, {
      staticFiles: {
        "css/app.css": "body{}",
        "chunks/main-app.js": "/* main-app */",
      },
    });

    const { stdout, stderr } = await execFileAsync(
      "bash",
      [
        SCRIPT,
        "--root",
        root,
        "--readiness",
        "http://127.0.0.1:3211/health/readiness",
      ],
      { encoding: "utf8" },
    ).catch((error: { stdout?: string; stderr?: string }) => ({
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    }));

    const combined = `${stdout}${stderr}`;
    expect(combined).toMatch(/ATOMIC DEPLOY CHECK FAILED/);
    expect(combined).toMatch(/readiness/);
    expect(combined).not.toMatch(/PASSED/);
  });
});
