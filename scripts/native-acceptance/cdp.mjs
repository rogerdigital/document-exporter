// Minimal Chrome DevTools Protocol client for driving the real Obsidian
// renderer (Electron) — no synthetic macOS input. Node >= 22 (global WebSocket).
import fs from "node:fs";

export const PORT = 9223;

export async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  if (!res.ok) throw new Error(`CDP /json failed: ${res.status}`);
  return res.json();
}

export async function findVaultTarget(vaultName) {
  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === "page");
  const hit = pages.find((t) => t.title.includes(`${vaultName} - Obsidian`));
  if (!hit) {
    throw new Error(
      `No CDP page target for vault "${vaultName}". Pages: ${pages.map((t) => t.title).join(" ; ")}`,
    );
  }
  return hit;
}

export class CDP {
  constructor(ws, title) {
    this.ws = ws;
    this.title = title;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.data ?? ""})`));
        else resolve(msg.result);
      }
    });
  }

  static async connect(wsUrl, title = "") {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket connect timeout")), 10_000);
      ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP websocket error")); }, { once: true });
    });
    return new CDP(ws, title);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP call timeout: ${method}`));
        }
      }, 60_000);
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  close() {
    this.ws.close();
  }

  /** Evaluate an expression (or async IIFE) returning a JSON value. Throws on JS exceptions. */
  async evalJs(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`evalJs exception: ${d.exception?.description ?? d.text}`);
    }
    return r.result?.value;
  }

  /** Poll until expression returns a truthy value; returns that value. */
  async waitFor(expression, { timeoutMs = 30_000, pollMs = 150, label = expression.slice(0, 80) } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        const v = await this.evalJs(expression);
        if (v) return v;
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`waitFor timeout (${timeoutMs}ms): ${label}${lastErr ? ` — last error: ${lastErr.message}` : ""}`);
  }

  /** Click the center of the element resolved by `elExpr` using trusted renderer input. */
  async clickEl(elExpr, { label = "element", timeoutMs = 10_000 } = {}) {
    await this.waitFor(`!!(${elExpr})`, { timeoutMs, label: `presence: ${label}` });
    const rect = await this.evalJs(`(() => { const el = ${elExpr}; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    if (!rect || rect.w === 0 || rect.h === 0) throw new Error(`clickEl: ${label} has empty rect`);
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    return { x, y };
  }

  /** Right-click the center of the element resolved by `elExpr` using trusted renderer input. */
  async rightClickEl(elExpr, { label = "element", timeoutMs = 10_000 } = {}) {
    await this.waitFor(`!!(${elExpr})`, { timeoutMs, label: `presence: ${label}` });
    const rect = await this.evalJs(`(() => { const el = ${elExpr}; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    if (!rect || rect.w === 0 || rect.h === 0) throw new Error(`rightClickEl: ${label} has empty rect`);
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", clickCount: 1 });
    return { x, y };
  }

  async screenshot(filePath) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(filePath, Buffer.from(r.data, "base64"));
    return filePath;
  }
}
