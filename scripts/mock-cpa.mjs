// 可控的 CPA 替身：提供 /v1/models 与 /v1/messages，用于验证模型列表获取、
// 失败场景，以及真实 CLI 发出的请求使用的实际模型 ID。
//
//   node scripts/mock-cpa.mjs [--port 28317] [--key test-key] [--log path.jsonl]
//
// 切换列表行为：GET /__set?models=ok|error|invalid|empty|slow
// 日志只记录路径、模型 ID 和鉴权是否匹配，不记录 Key。
import http from "node:http";
import fs from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);
const port = Number(args.port ?? 28317);
const key = args.key ?? "test-key";
const logPath = args.log;

const MODELS = [
  { id: "gpt-5.1-codex", object: "model", owned_by: "cpa" },
  { id: "qwen3-coder-plus", object: "model", owned_by: "cpa", display_name: "Qwen3 Coder Plus" },
  { id: "deepseek-v3.2", object: "model", owned_by: "cpa" },
];
let modelsMode = "ok";

function log(entry) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...entry });
  console.log(line);
  if (logPath) fs.appendFileSync(logPath, line + "\n");
}

function authorized(req) {
  const bearer = req.headers.authorization === `Bearer ${key}`;
  const xkey = req.headers["x-api-key"] === key;
  return bearer || xkey;
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (url.pathname === "/__set") {
      modelsMode = url.searchParams.get("models") ?? "ok";
      log({ path: "/__set", modelsMode });
      return send(res, 200, { modelsMode });
    }
    const auth = authorized(req);
    if (url.pathname === "/v1/models" && req.method === "GET") {
      log({ path: "/v1/models", auth, modelsMode });
      if (!auth) return send(res, 401, { error: { type: "authentication_error", message: "invalid key" } });
      if (modelsMode === "error") return send(res, 500, { error: "upstream unavailable" });
      if (modelsMode === "invalid") return send(res, 200, "<html>gateway error</html>", "text/html");
      if (modelsMode === "empty") return send(res, 200, { object: "list", data: [] });
      if (modelsMode === "slow") return setTimeout(() => send(res, 200, { object: "list", data: MODELS }), 20000);
      return send(res, 200, { object: "list", data: MODELS, has_more: false });
    }
    if (url.pathname.startsWith("/v1/messages") && req.method === "POST") {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {}
      log({ path: url.pathname, auth, model: body.model, stream: !!body.stream });
      if (!auth) return send(res, 401, { error: { type: "authentication_error", message: "invalid key" } });
      if (url.pathname === "/v1/messages/count_tokens") return send(res, 200, { input_tokens: 12 });
      const text = `mock reply from ${body.model}`;
      const id = `msg_mock_${Date.now()}`;
      const usage = { input_tokens: 12, output_tokens: 6 };
      if (!body.stream) {
        return send(res, 200, {
          id,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage,
        });
      }
      return sse(res, [
        ["message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 6 } }],
        ["message_stop", { type: "message_stop" }],
      ]);
    }
    log({ path: url.pathname, method: req.method, auth, unhandled: true });
    send(res, 404, { error: { type: "not_found_error", message: url.pathname } });
  });
});

server.listen(port, "127.0.0.1", () => console.log(`mock CPA listening on http://127.0.0.1:${port}`));
