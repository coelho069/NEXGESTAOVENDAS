import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readLimitedJson, readLimitedText } from "@/lib/security/read-limited-body";

function chunkedRequest(chunks: string[]): Request {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Request("http://localhost/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
}

describe("readLimitedText", () => {
  it("lê corpo dentro do limite, sem Content-Length", async () => {
    const req = chunkedRequest(['{"a":', "1}"]);
    await expect(readLimitedJson(req, 100)).resolves.toEqual({ a: 1 });
  });

  it("recusa corpo chunked acima do limite mesmo sem Content-Length", async () => {
    const big = "x".repeat(60);
    const req = chunkedRequest([big, big]);
    await expect(readLimitedText(req, 100)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("recusa pelo Content-Length declarado acima do limite antes de ler", async () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "999999" },
    });
    await expect(readLimitedText(req, 100)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
