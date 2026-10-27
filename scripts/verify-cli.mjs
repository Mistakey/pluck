// 在隔离用户目录中用真实 Claude Code CLI 验证 Pluck 的配置管理（A2–A7）。
//
//   pnpm verify:cli [--keep] [--report path.md]
//
// 步骤：可控 CPA 替身 → Pluck 服务层（pluckctl，与桌面应用同一代码）保存连接、获取列表、
// 设置模型并切换 → 真实 CLI 的 /model 菜单中查看并选择实际模型 ID → 往返切换与重开读回。
// 不读取也不修改当前用户真实的 ~/.claude；报告与输出不包含 Key。
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startTui, KEY } from "./lib/tui.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const reportPath = argv.includes("--report") ? path.resolve(argv[argv.indexOf("--report") + 1]) : null;

const KEY_VALUE = `pluck-verify-${crypto.randomBytes(6).toString("hex")}`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pluck-verify-"));
const claudeDir = path.join(root, "claude");
const dataDir = path.join(root, "pluck-data");
const projA = path.join(root, "proj-a");
const projB = path.join(root, "proj-b");
const settingsPath = path.join(claudeDir, "settings.json");
const credPath = path.join(claudeDir, ".credentials.json");
const projBSettings = path.join(projB, ".claude", "settings.json");
const mockLog = path.join(root, "mock-cpa.jsonl");

const CLAUDE = process.platform === "win32" ? "claude.exe" : "claude";
const results = [];
let mock;

function check(id, desc, cond, detail = "") {
  results.push({ id, desc, ok: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"} [${id}] ${desc}${detail ? ` — ${detail}` : ""}`);
}

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cliEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/i.test(k)));
  env.CLAUDE_CONFIG_DIR = claudeDir;
  return env;
}

// ---- 准备 ----
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const EXISTING = {
  permissions: { allow: ["Bash(git status)"], deny: ["Read(./.env)"] },
  hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
  enabledPlugins: { "example@local": true },
  env: { MY_UNKNOWN_VAR: "keep-me", ENABLE_TOOL_SEARCH: "true" },
  model: "opus",
  theme: "dark",
};
const CREDENTIALS = JSON.stringify({ claudeAiOauth: { accessToken: "official-access", refreshToken: "official-refresh", expiresAt: 4102444800000 } });

function seed() {
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(projA, { recursive: true });
  fs.mkdirSync(path.dirname(projBSettings), { recursive: true });
  // Windows 编辑器常见的 CRLF 换行。
  fs.writeFileSync(settingsPath, JSON.stringify(EXISTING, null, 2).replace(/\n/g, "\r\n") + "\r\n");
  fs.writeFileSync(credPath, CREDENTIALS);
  const trust = { hasTrustDialogAccepted: true, allowedTools: [] };
  fs.writeFileSync(
    path.join(claudeDir, ".claude.json"),
    JSON.stringify(
      {
        hasCompletedOnboarding: true,
        lastOnboardingVersion: "9.9.9",
        theme: "dark",
        projects: { [projA.replace(/\\/g, "/")]: trust, [projB.replace(/\\/g, "/")]: trust },
      },
      null,
      2,
    ),
  );
  // 项目级覆盖：Pluck 不应改写它，CLI 在该项目中应优先使用它。
  fs.writeFileSync(projBSettings, JSON.stringify({ model: "deepseek-v3.2" }, null, 2));
}

let pluckctlExe;
function buildPluckctl() {
  execFileSync("cargo", ["build", "--quiet", "--example", "pluckctl", "--manifest-path", path.join(repo, "src-tauri", "Cargo.toml")], {
    stdio: "inherit",
  });
  pluckctlExe = path.join(repo, "src-tauri", "target", "debug", "examples", process.platform === "win32" ? "pluckctl.exe" : "pluckctl");
}

function pluck(...args) {
  try {
    const out = execFileSync(pluckctlExe, ["--claude-dir", claudeDir, "--data-dir", dataDir, ...args], { encoding: "utf8" });
    if (out.includes(KEY_VALUE)) throw new Error("pluckctl 输出包含 Key");
    return JSON.parse(out);
  } catch (e) {
    if (e.stdout) {
      if (e.stdout.includes(KEY_VALUE)) throw new Error("pluckctl 输出包含 Key");
      return JSON.parse(e.stdout);
    }
    throw e;
  }
}

async function startMock(port) {
  mock = spawn(process.execPath, [path.join(repo, "scripts", "mock-cpa.mjs"), "--port", String(port), "--key", KEY_VALUE, "--log", mockLog], {
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/__set?models=ok`);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("CPA 替身未启动");
}

const mockModels = () =>
  fs.existsSync(mockLog)
    ? fs
        .readFileSync(mockLog, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
        .filter((e) => e.path === "/v1/messages" && e.model)
    : [];

function headless(cwd, prompt, extra = []) {
  const before = mockModels().length;
  execFileSync(CLAUDE, ["-p", prompt, ...extra], { cwd, env: cliEnv(), encoding: "utf8", timeout: 120000 });
  return mockModels().slice(before).map((e) => e.model);
}

async function withTui(cwd, fn) {
  const t = startTui(CLAUDE, [], { cwd, env: cliEnv() });
  try {
    // 启动时可能出现的确认：上级目录的 CLAUDE.md 外部引用一律拒绝；隔离项目目录选择信任。
    const start = Date.now();
    for (;;) {
      const scr = await t.waitFor(/❯\s*$|Allow external CLAUDE\.md|trust this folder/m, 60000);
      if (/Allow external CLAUDE\.md/.test(scr)) {
        await moveTo(t, "No, disable");
        t.write(KEY.enter);
      } else if (/trust this folder/.test(scr)) {
        await moveTo(t, "Yes, I trust");
        t.write(KEY.enter);
      } else break;
      if (Date.now() - start > 60000) throw new Error("启动确认未结束");
      await t.sleep(1500);
    }
    await t.sleep(5000);
    return await fn(t);
  } finally {
    t.write(KEY.ctrlC);
    await t.sleep(300);
    t.write(KEY.ctrlC);
    await t.sleep(1000);
    t.kill();
  }
}

async function openPicker(t) {
  await t.type("/model");
  await t.sleep(800);
  t.write(KEY.enter);
  return t.waitFor(/Select model[\s\S]*Enter to set as default/, 20000);
}

// 把光标移动到包含 text 的行。
async function moveTo(t, text) {
  for (let i = 0; i < 12; i++) {
    // 当前选中行是最后一个带 ❯ 的行（其上可能有回显的输入行）。
    const line = t.screen().split("\n").filter((l) => /^\s*❯\s+\S/.test(l)).pop();
    if (line && line.includes(text)) return;
    t.write(KEY.down);
    await t.sleep(400);
  }
  throw new Error(`菜单中找不到 ${text}\n${t.screen()}`);
}

// ---- 流程 ----
async function main() {
  const osVersion = os.version() + " " + os.release();
  const cliVersion = execFileSync(CLAUDE, ["--version"], { encoding: "utf8" }).trim();
  console.log(`OS: ${osVersion}\nCLI: ${cliVersion}\n隔离目录: ${root}`);
  seed();
  buildPluckctl();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  await startMock(port);
  const credHash = sha(credPath);
  const projBHash = sha(projBSettings);

  // A2：保存 CPA。
  let r = pluck("save-cpa", base + "/", KEY_VALUE);
  check("A2", "保存 CPA 连接，状态只显示 Key 尾号", r.status?.cpaBaseUrl === base && r.status.cpaKeyHint?.startsWith("****"));

  // A3：获取列表，实际 ID 不改名。
  r = pluck("refresh");
  const ids = (r.models ?? []).map((m) => m.id);
  check("A3", "从 CPA 获取到非 Claude 命名的模型", JSON.stringify(ids) === JSON.stringify(["gpt-5.1-codex", "qwen3-coder-plus", "deepseek-v3.2"]), ids.join(", "));

  // A3/A6：失败与无效响应保留已有列表。
  for (const mode of ["error", "invalid", "empty"]) {
    await fetch(`${base}/__set?models=${mode}`);
    const before = sha(settingsPath);
    const e = pluck("refresh");
    const after = pluck("models");
    check("A3/A6", `CPA ${mode} 时报错并保留原列表与配置`, e.error && after.models.length === 3 && sha(settingsPath) === before, e.error);
  }
  await fetch(`${base}/__set?models=ok`);
  pluck("save-cpa", base, KEY_VALUE.replace(/.$/, "x"));
  const badKey = pluck("refresh");
  check("A3/A6", "Key 错误时报错并保留原列表", badKey.error?.includes("401") && pluck("models").models.length === 3, badKey.error);
  pluck("save-cpa", base, KEY_VALUE);

  // A4：官方模式下保存 CPA 模型配置，不改实时文件。
  const offBefore = sha(settingsPath);
  r = pluck(
    "set-models",
    JSON.stringify({
      defaultModel: "gpt-5.1-codex",
      subagentModel: "qwen3-coder-plus",
      aliasOpus: null,
      aliasSonnet: null,
      aliasHaiku: "deepseek-v3.2",
      pickerModels: ["gpt-5.1-codex", "qwen3-coder-plus", "deepseek-v3.2"],
      replaceBuiltIn: true,
    }),
  );
  check("A4", "官方模式下保存 CPA 模型配置不改动用户文件", !r.error && sha(settingsPath) === offBefore);

  // A2：切到 CPA。
  r = pluck("switch", "cpa");
  let s = readJson(settingsPath);
  check(
    "A2/A4",
    "切到 CPA 写入连接、菜单、默认/子代理/别名",
    r.status?.mode === "cpa" &&
      s.env.ANTHROPIC_BASE_URL === base &&
      s.env.ANTHROPIC_AUTH_TOKEN === KEY_VALUE &&
      s.model === "gpt-5.1-codex" &&
      s.env.CLAUDE_CODE_SUBAGENT_MODEL === "qwen3-coder-plus" &&
      s.env.ANTHROPIC_DEFAULT_HAIKU_MODEL === "deepseek-v3.2" &&
      s.modelPicker?.options?.length === 3 &&
      s.modelPicker.replaceBuiltInOptions === true,
  );
  check("A7", "切换结果提示重开 CLI 及项目/启动覆盖", /重新打开/.test(r.message) && /项目级设置/.test(r.message));
  check("A6", "写回后保留 CRLF 换行", fs.readFileSync(settingsPath, "utf8").includes("\r\n"));

  // A3：真实 CLI 的 /model 菜单可见并选择实际 ID（保存为默认 → Y）。
  await withTui(projA, async (t) => {
    const scr = await openPicker(t);
    check("A3", "CLI /model 菜单显示 CPA 模型（实际 ID 与显示名）", ["gpt-5.1-codex", "Qwen3 Coder Plus", "deepseek-v3.2"].every((x) => scr.includes(x)));
    check("A3", "替换内置菜单后不显示 Claude 系列行", !/\d+\.\s+(Opus|Sonnet|Haiku)\b/.test(scr));
    await moveTo(t, "Qwen3 Coder Plus");
    t.write(KEY.enter);
    await t.waitFor(/saved as your default/, 15000);
  });
  s = readJson(settingsPath);
  check("A3/A5", "CLI 以实际 ID 保存默认模型 Y", s.model === "qwen3-coder-plus", s.model);
  let used = headless(projA, "say hi");
  check("A3", "CLI 请求使用实际模型 ID", used.length > 0 && used.every((m) => m === "qwen3-coder-plus"), used.join(", "));

  // A5：仅当前会话的选择不误作持久配置。
  await withTui(projA, async (t) => {
    await openPicker(t);
    await moveTo(t, "deepseek-v3.2");
    t.write("s");
    await t.sleep(2000);
    await t.type("say hi");
    await t.sleep(500);
    t.write(KEY.enter);
    await t.waitFor(/mock reply from deepseek-v3\.2/, 30000);
    check("A5", "会话临时选择在当前会话中生效", true, "deepseek-v3.2");
  });
  s = readJson(settingsPath);
  let st = pluck("status");
  check("A5", "会话临时选择不改动已保存的默认模型", s.model === "qwen3-coder-plus" && st.model === "qwen3-coder-plus", `${s.model} / ${st.model}`);

  // 模拟之后新增的无关字段（CLI 或用户添加）。
  const raw = fs.readFileSync(settingsPath, "utf8");
  const later = readJson(settingsPath);
  later.laterAddedField = { addedAfterSwitch: true };
  later.env.LATER_VAR = "1";
  fs.writeFileSync(settingsPath, JSON.stringify(later, null, 2).replace(/\n/g, raw.includes("\r\n") ? "\r\n" : "\n") + "\r\n");

  // A5：往返。
  r = pluck("switch", "official");
  s = readJson(settingsPath);
  const leaked = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_SUBAGENT_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"].filter((k) => k in (s.env ?? {}));
  check("A2/A5", "切回官方：CPA 连接与模型覆盖不带回", r.status?.mode === "official" && leaked.length === 0 && !("modelPicker" in s), leaked.join(","));
  check("A5", "官方模式恢复自己的最新已保存模型", s.model === "opus", s.model);
  check("A5", "其他设置与后来新增字段保持", JSON.stringify([s.permissions, s.hooks, s.enabledPlugins, s.theme, s.env.MY_UNKNOWN_VAR, s.laterAddedField, s.env.LATER_VAR]) ===
    JSON.stringify([EXISTING.permissions, EXISTING.hooks, EXISTING.enabledPlugins, EXISTING.theme, "keep-me", { addedAfterSwitch: true }, "1"]));
  check("A2", "官方登录凭据文件不变", sha(credPath) === credHash);

  r = pluck("switch", "cpa");
  s = readJson(settingsPath);
  check("A5", "再切回 CPA 仍为 CLI 保存的 Y", s.model === "qwen3-coder-plus" && s.env.CLAUDE_CODE_SUBAGENT_MODEL === "qwen3-coder-plus" && s.modelPicker?.options?.length === 3, s.model);
  used = headless(projA, "say hi");
  check("A5", "往返后 CLI 新会话使用 Y", used.length > 0 && used.every((m) => m === "qwen3-coder-plus"), used.join(", "));

  // 重开（新进程读取）后读回。
  st = pluck("status");
  const view = pluck("models");
  check("A1/A5", "重开后读回模式、CPA、模型与列表", st.mode === "cpa" && st.model === "qwen3-coder-plus" && view.source === "live" && view.models.length === 3);

  // A7：项目级与启动参数覆盖保持原生规则。
  used = headless(projB, "say hi");
  check("A7", "项目级 model 覆盖用户级默认", used.length > 0 && used[0] === "deepseek-v3.2", used.join(", "));
  used = headless(projA, "say hi", ["--model", "gpt-5.1-codex"]);
  check("A7", "启动参数 --model 覆盖用户级默认", used.length > 0 && used[0] === "gpt-5.1-codex", used.join(", "));
  pluck("switch", "official");
  pluck("switch", "cpa");
  check("A7", "切换不改写项目级设置", sha(projBSettings) === projBHash);

  // A4：取消指定。
  r = pluck("set-models", JSON.stringify({ ...view.config, subagentModel: null, aliasHaiku: null }));
  s = readJson(settingsPath);
  check("A4", "取消子代理默认与别名后移除对应原生配置", !r.error && !("CLAUDE_CODE_SUBAGENT_MODEL" in s.env) && !("ANTHROPIC_DEFAULT_HAIKU_MODEL" in s.env) && s.model === "qwen3-coder-plus");

  // A6：损坏的用户文件。
  // （读取后被外部修改、只读与文件占用由 Rust 集成测试覆盖。）
  const extHash = sha(settingsPath);
  fs.copyFileSync(settingsPath, path.join(root, "good.json"));
  fs.writeFileSync(settingsPath, '{ "model": "broken", ');
  const brokenHash = sha(settingsPath);
  r = pluck("switch", "official");
  check("A6", "损坏的 settings.json 拒绝切换且不被覆盖", r.error && sha(settingsPath) === brokenHash, r.error);
  check("A6", "损坏时状态显示为无法读取", pluck("status").mode === "error");
  fs.writeFileSync(settingsPath, fs.readFileSync(path.join(root, "good.json")));
  check("A6", "恢复文件后可继续读取", sha(settingsPath) === extHash && pluck("status").mode === "cpa");

  pluck("switch", "official");
  check("A2", "全程官方凭据文件不变", sha(credPath) === credHash);
  const dataText = fs.readFileSync(path.join(dataDir, "state.json"), "utf8");
  check("D3", "Key 只保存在本机数据和 CPA 模式的用户配置中", dataText.includes(KEY_VALUE) && !fs.readFileSync(settingsPath, "utf8").includes(KEY_VALUE));

  return { osVersion, cliVersion };
}

function writeReport(meta, error) {
  const pass = results.filter((r) => r.ok).length;
  const lines = [
    `# CLI 隔离验证报告`,
    ``,
    `- 时间：${new Date().toISOString()}`,
    `- 操作系统：${meta?.osVersion ?? os.version()}`,
    `- Claude Code：${meta?.cliVersion ?? "?"}`,
    `- 结果：${pass}/${results.length} 通过${error ? `；中止：${error}` : ""}`,
    ``,
    `| 验收 | 检查 | 结果 | 说明 |`,
    `| --- | --- | --- | --- |`,
    ...results.map((r) => `| ${r.id} | ${r.desc} | ${r.ok ? "通过" : "失败"} | ${String(r.detail ?? "").replace(/\|/g, "\\|").replaceAll(KEY_VALUE, "***")} |`),
  ];
  const text = lines.join("\n") + "\n";
  if (reportPath) fs.writeFileSync(reportPath, text);
  return pass === results.length && !error;
}

let meta;
let failure;
try {
  meta = await main();
} catch (e) {
  failure = String(e?.message ?? e).split("\n")[0];
  console.error(e);
} finally {
  mock?.kill();
  await sleep(300);
  if (!keep) fs.rmSync(root, { recursive: true, force: true });
  else console.log(`保留隔离目录：${root}`);
}
const ok = writeReport(meta, failure);
console.log(ok ? "全部通过" : "存在失败");
process.exit(ok ? 0 : 1);
