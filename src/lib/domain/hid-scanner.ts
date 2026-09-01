const INTER_KEY_MS = 45;
const MIN_CODE_LENGTH = 4;
const CODE_CHAR = /^[0-9A-Za-z\-._]$/;

export type HidScanPush = { type: "scan"; code: string } | { type: "none" };

export class HidScanAssembler {
  private buffer = "";
  private lastAt = 0;
  private rapidCount = 0;

  reset(): void {
    this.buffer = "";
    this.lastAt = 0;
    this.rapidCount = 0;
  }

  push(key: string, now: number): HidScanPush {
    if (key === "Enter") {
      const code = this.buffer;
      const isScan = code.length >= MIN_CODE_LENGTH && this.rapidCount >= MIN_CODE_LENGTH - 1;
      this.reset();
      if (isScan) return { type: "scan", code };
      return { type: "none" };
    }

    if (!CODE_CHAR.test(key)) {
      this.reset();
      return { type: "none" };
    }

    if (this.lastAt > 0 && now - this.lastAt > INTER_KEY_MS) {
      this.buffer = "";
      this.rapidCount = 0;
    } else if (this.buffer.length > 0 && now - this.lastAt <= INTER_KEY_MS) {
      this.rapidCount += 1;
    }

    this.buffer += key;
    this.lastAt = now;
    return { type: "none" };
  }
}