import { execFileSync, execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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

  it("derives sample-chunk origin from readiness URL and prefers main-app.js", async () => {
    const root = makeRoot();
    roots.push(root);
    writeStandalone(root, {
      staticFiles: {
        "css/app.css": "body{}",
        "main-app-stale.js": "/* stale outside chunks */",
        "chunks/webpack-aaa.js": "/* webpack */",
        "chunks/main-app-abc.js": "/* main-app */",
      },
    });

    const requested: string[] = [];
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "";
      requested.push(url);
      if (url.startsWith("/health/readiness")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ready" }));
        return;
      }
      if (url.includes("main-app-abc.js")) {
        res.writeHead(200, { "content-type": "application/javascript" });
        res.end("/* main-app */");
        return;
      }
      res.writeHead(404);
      res.end("no");
    });

    await new Promise<void>((resolveListen) => {
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected tcp address");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const { stdout, stderr } = await execFileAsync(
        "bash",
        [SCRIPT, "--root", root, "--readiness", `${origin}/health/readiness`],
        { encoding: "utf8" },
      );
      expect(stderr).toBe("");
      expect(stdout).toMatch(/PASSED/);
      expect(stdout).toMatch(/main-app-abc\.js/);
      expect(stdout).not.toMatch(/127\.0\.0\.1:3211/);
      expect(requested.some((url) => url.includes("main-app-abc.js"))).toBe(
        true,
      );
      expect(requested.some((url) => url.includes("app.css"))).toBe(false);
      expect(requested.some((url) => url.includes("main-app-stale.js"))).toBe(
        false,
      );
      expect(requested.some((url) => url.includes("/chunks/main-app-abc.js"))).toBe(
        true,
      );
    } finally {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
    }
  });

  it("does not treat a stale main-app.js outside chunks/ as a sample", () => {
    const root = makeRoot();
    roots.push(root);
    writeStandalone(root, {
      staticFiles: {
        "css/app.css": "body{}",
        "main-app-stale.js": "/* stale */",
      },
    });

    const result = runCheck(root, [
      "--readiness",
      "http://127.0.0.1:3211/health/readiness",
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(
      /ATOMIC DEPLOY CHECK FAILED/,
    );
    expect(`${result.stdout}${result.stderr}`).toMatch(/chunks\/\*\.js|main-app/);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/PASSED/);
  });

  it("fails when --readiness has no JS chunk to sample", () => {
    const root = makeRoot();
    roots.push(root);
    writeStandalone(root, {
      staticFiles: {
        "css/app.css": "body{}",
      },
      html: '<link href="/_next/static/css/app.css" rel="stylesheet"/>',
    });

    const result = runCheck(root, [
      "--readiness",
      "http://127.0.0.1:3211/health/readiness",
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(
      /ATOMIC DEPLOY CHECK FAILED/,
    );
    expect(`${result.stdout}${result.stderr}`).toMatch(/chunks\/\*\.js|main-app/);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/PASSED/);
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
