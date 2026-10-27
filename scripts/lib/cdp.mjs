// 极简 Chrome DevTools Protocol 客户端：连接 WebView2 远程调试端口，驱动 Pluck 窗口。
import fs from "node:fs";

export async function connect(port, { timeout = 30000 } = {}) {
  const start = Date.now();
  let target;
  while (Date.now() - start < timeout) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === "page" && /tauri\.localhost|localhost/.test(t.url));
      if (target) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!target) throw new Error("找不到 Pluck 页面");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  async function evaluate(expr) {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async function waitFor(expr, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`等待超时：${expr}`);
  }

  const text = () => evaluate("document.body.innerText");

  // 按钮按文字点击。
  const click = (label) =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!b) throw new Error("没有按钮 " + ${JSON.stringify(label)});
      if (b.disabled) throw new Error("按钮不可用 " + ${JSON.stringify(label)});
      b.click(); return true;
    })()`);

  // 填写受控输入框（React 需要原生 setter 与 input 事件）。
  const fill = (selector, value) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      return true;
    })()`);

  // 按标签文字选择下拉框。
  const choose = (label, value) =>
    evaluate(`(() => {
      const f = [...document.querySelectorAll("label.field")].find((x) => x.querySelector(".field-label")?.textContent === ${JSON.stringify(label)});
      const el = f.querySelector("select");
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    })()`);

  async function screenshot(file) {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  }

  return { send, evaluate, waitFor, text, click, fill, choose, screenshot, close: () => ws.close() };
}
