import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const base = path.resolve(".forge/tmp");
fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, "updates-probe-"));
let checks = 0, downloads = 0;
const server = http.createServer((req, res) => {
  if (req.url !== "/latest.json") { downloads++; res.writeHead(404).end(); return; }
  checks++;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ version: "9.0.0", notes: "原生常驻更新检查", platforms: { "windows-x86_64": {
    url: `http://127.0.0.1:${server.address().port}/package`,
    signature: fs.readFileSync("src-tauri/tests/fixtures/updater/payload.txt.sig", "utf8").trim(),
  } } }));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLAUDE|ANTHROPIC|PLUCK|WEBVIEW2)/i.test(key)));
Object.assign(env, {
  CLAUDE_CONFIG_DIR: path.join(root, "claude"), PLUCK_DATA_DIR: path.join(root, "data"),
  WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
  PLUCK_PROBE_ENDPOINT: `http://127.0.0.1:${server.address().port}/latest.json`,
});
let result;
try {
  const child = spawn(path.resolve("src-tauri/target/debug/examples/updates_probe.exe"), [], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
  let output = "", errors = "";
  child.stdout.on("data", chunk => output += chunk);
  child.stderr.on("data", chunk => errors += chunk);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  assert.equal(code, 0, errors);
  result = JSON.parse(output.trim());
  assert.equal(checks, 1);
  assert.equal(downloads, 0);
  assert.equal(result.status.currentVersion, JSON.parse(fs.readFileSync("package.json")).version);
} finally {
  await new Promise(resolve => server.close(resolve));
  // WebView's browser process releases the profile after the native app exits.
  // Keep the event loop live while waiting for those handles to close.
  assert(root.startsWith(base + path.sep));
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 });
}
fs.writeFileSync(path.join(base, "updates-probe.json"), JSON.stringify({ ...result, checks, downloads }, null, 2));
console.log("PASS production background auto-check, two hidden window recreations, no focus, no downloads");
