// 按需的 Claude Code 兼容检查：配置映射变更或 CLI 升级后运行。
// 只验证真实 /model 菜单、CLI 保存实际 ID、切换后仍可使用；其余由 Rust 测试负责。
// pnpm verify:cli [--report path.md] [--keep]
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startTui, KEY } from "./lib/tui.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const report = args.includes("--report") ? path.resolve(args[args.indexOf("--report") + 1]) : null;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pluck-cli-"));
const claudeDir = path.join(root, "claude");
const dataDir = path.join(root, "data");
const project = path.join(root, "project");
const settings = path.join(claudeDir, "settings.json");
const mockLog = path.join(root, "requests.jsonl");
const key = `pluck-verify-${crypto.randomBytes(6).toString("hex")}`;
const cli = process.platform === "win32" ? "claude.exe" : "claude";
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/i.test(k)));
env.CLAUDE_CONFIG_DIR = claudeDir;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readSettings = () => JSON.parse(fs.readFileSync(settings, "utf8"));
const results = [];
let mock;
let cliVersion;

function check(description, ok) {
  results.push({ description, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${description}`);
  if (!ok) throw new Error(description);
}

const pluckctl = path.join(repo, "src-tauri/target/debug/examples", process.platform === "win32" ? "pluckctl.exe" : "pluckctl");
function pluck(...argv) {
  const result = JSON.parse(execFileSync(pluckctl, ["--claude-dir", claudeDir, "--data-dir", dataDir, ...argv], { encoding: "utf8" }));
  if (result.error) throw new Error(result.error.replaceAll(key, "***"));
  return result;
}

async function moveTo(tui, text) {
  for (let i = 0; i < 12; i++) {
    const selected = tui.screen().split("\n").filter((line) => /^\s*❯\s+\S/.test(line)).pop();
    if (selected?.includes(text)) return;
    tui.write(KEY.down);
    await tui.sleep(400);
  }
  throw new Error(`菜单中找不到 ${text}`);
}

async function main() {
  cliVersion = execFileSync(cli, ["--version"], { encoding: "utf8" }).trim();
  console.log(cliVersion);
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ model: "opus" }));
  fs.writeFileSync(path.join(claudeDir, ".claude.json"), JSON.stringify({
    hasCompletedOnboarding: true, lastOnboardingVersion: "9.9.9", theme: "dark",
    projects: { [project.replace(/\\/g, "/")]: { hasTrustDialogAccepted: true, allowedTools: [] } },
  }));
  execFileSync("cargo", ["build", "--quiet", "--example", "pluckctl", "--manifest-path", "src-tauri/Cargo.toml"], {
    cwd: repo, stdio: "inherit",
  });
  const port = await new Promise((resolve) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  mock = spawn(process.execPath, [path.join(repo, "scripts/mock-cpa.mjs"), "--port", String(port), "--key", key, "--log", mockLog], {
    stdio: "ignore", windowsHide: true,
  });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { ready = (await fetch(`${base}/__set?models=ok`)).ok; } catch {}
    if (ready) break;
    await sleep(100);
  }
  if (!ready) throw new Error("CPA 替身未启动");
  pluck("save-cpa", base, key);
  pluck("refresh");
  pluck("set-models", JSON.stringify({
    defaultModel: "gpt-5.1-codex", subagentModel: "qwen3-coder-plus",
    aliasOpus: null, aliasSonnet: null, aliasHaiku: null,
    pickerModels: ["gpt-5.1-codex", "qwen3-coder-plus", "deepseek-v3.2"], replaceBuiltIn: true,
  }));
  pluck("switch", "cpa");

  // 独立 PTY，不操作用户的终端窗口、鼠标或托盘。
  const tui = startTui(cli, [], { cwd: project, env });
  try {
    for (;;) {
      const screen = await tui.waitFor(/❯\s*$|Allow external CLAUDE\.md|trust this folder/m, 60000);
      if (/Allow external CLAUDE\.md/.test(screen)) {
        await moveTo(tui, "No, disable");
      } else if (/trust this folder/.test(screen)) {
        await moveTo(tui, "Yes, I trust");
      } else break;
      tui.write(KEY.enter);
      await tui.sleep(1500);
    }
    await tui.sleep(5000);
    await tui.type("/model");
    await tui.sleep(800);
    tui.write(KEY.enter);
    const picker = await tui.waitFor(/Select model[\s\S]*Enter to set as default/, 20000);
    check("原生模型菜单显示 CPA 的实际 ID 与显示名", ["gpt-5.1-codex", "Qwen3 Coder Plus", "deepseek-v3.2"].every((id) => picker.includes(id)));
    check("原生菜单接受替换内置选项的配置", !/\d+\.\s+(Opus|Sonnet|Haiku)\b/.test(picker));
    await moveTo(tui, "Qwen3 Coder Plus");
    tui.write(KEY.enter);
    await tui.waitFor(/saved as your default/, 15000);
    check("CLI 以实际 ID 保存所选模型", readSettings().model === "qwen3-coder-plus");
  } finally {
    tui.write(KEY.ctrlC);
    await tui.sleep(300);
    tui.write(KEY.ctrlC);
    await tui.sleep(1000);
    tui.kill();
  }
  pluck("switch", "official");
  pluck("switch", "cpa");
  check("往返切换保留 CLI 保存的选择", readSettings().model === "qwen3-coder-plus");
  execFileSync(cli, ["-p", "say hi"], { cwd: project, env, encoding: "utf8", timeout: 120000 });
  const requests = fs.readFileSync(mockLog, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    .filter((entry) => entry.path === "/v1/messages" && entry.model);
  check("新会话请求使用实际模型 ID", requests.length > 0 && requests.every((entry) => entry.model === "qwen3-coder-plus"));
}

let failure;
try {
  await main();
} catch (e) {
  failure = String(e.message).replaceAll(key, "***").split("\n")[0];
  console.error(failure);
} finally {
  if (mock && mock.exitCode === null) {
    const ended = new Promise((resolve) => mock.once("exit", resolve));
    mock.kill();
    await ended;
  }
  if (args.includes("--keep")) console.log(`隔离目录：${root}`);
  else fs.rmSync(root, { recursive: true, force: true });
}
if (report) {
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, [
    "# CLI 原生配置兼容验证", "", `时间：${new Date().toISOString()}；CLI：${cliVersion ?? "未知"}。独立配置和 PTY，不操作用户桌面。`, "",
    ...results.map((r) => `- ${r.ok ? "通过" : "失败"}：${r.description}`),
    ...(failure ? [`- 中止：${failure}`] : []), "",
  ].join("\n"));
}
process.exitCode = failure ? 1 : 0;
