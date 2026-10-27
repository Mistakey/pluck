// 在 Windows 上启动 Pluck 构建产物，以隔离用户目录验证窗口、托盘、失败提示、重开读回，
// 并记录启动、托盘常驻资源和切换响应（A1、A2、A6、A7、D8）。
//
//   pnpm verify:desktop [--exe path\to\pluck.exe] [--evidence dir] [--report path.md]
//
// 窗口通过 WebView2 远程调试端口驱动；托盘通过 scripts/lib/tray.ps1（UI Automation + 键盘）操作。
// 运行期间会移动鼠标并在通知区域打开菜单，请勿同时操作桌面。
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./lib/cdp.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, def) => (argv.includes(name) ? path.resolve(argv[argv.indexOf(name) + 1]) : def);
const exe = arg("--exe", path.join(repo, "src-tauri", "target", "release", "pluck.exe"));
const evidence = arg("--evidence", path.join(repo, ".forge", "tmp", "desktop-evidence"));
const reportPath = arg("--report", path.join(evidence, "report.md"));
fs.mkdirSync(evidence, { recursive: true });

const KEY_VALUE = `pluck-desk-${crypto.randomBytes(6).toString("hex")}`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pluck-desktop-"));
const claudeDir = path.join(root, "claude");
const dataDir = path.join(root, "pluck-data");
const settingsPath = path.join(claudeDir, "settings.json");
const credPath = path.join(claudeDir, ".credentials.json");

const results = [];
const metrics = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));

function check(id, desc, cond, detail = "") {
  results.push({ id, desc, ok: !!cond, detail: String(detail ?? "").replaceAll(KEY_VALUE, "***") });
  console.log(`${cond ? "PASS" : "FAIL"} [${id}] ${desc}${detail ? ` — ${detail}` : ""}`);
}
function metric(name, value) {
  metrics.push({ name, value });
  console.log(`METRIC ${name}: ${value}`);
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function tray(action, extra = []) {
  return execFileSync("pwsh", ["-NoProfile", "-File", path.join(repo, "scripts", "lib", "tray.ps1"), "-Action", action, ...extra], {
    encoding: "utf8",
    timeout: 60000,
  }).trim();
}
// 用鼠标点击托盘菜单项，返回点击时刻（Unix 毫秒）。
const trayClick = (item, shot) =>
  Number(/clicked=(\d+)/.exec(tray("click", ["-Item", item, ...(shot ? ["-Shot", path.join(evidence, shot)] : [])]))?.[1]);
// 读取托盘菜单项（文字与是否可用）。
const trayMenu = (shot) => JSON.parse(tray("menu", shot ? ["-Shot", path.join(evidence, shot)] : []));
const menuItem = (menu, prefix) => menu.find((m) => m.text.startsWith(prefix));

async function until(fn, timeout = 10000, step = 50) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

// 进程树（pluck.exe 及其 WebView2 子进程）的内存与 CPU。
function processTree(pid) {
  const ps = `
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
$ids = New-Object System.Collections.Generic.List[int]; $ids.Add(${pid})
do { $n = $ids.Count; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { $ids.Add([int]$p.ProcessId) } } } while ($ids.Count -ne $n)
$procs = Get-Process -Id $ids -ErrorAction SilentlyContinue
$main = Get-Process -Id ${pid}
[pscustomobject]@{ mainWs = $main.WorkingSet64; mainPriv = $main.PrivateMemorySize64; count = $procs.Count; ws = ($procs | Measure-Object WorkingSet64 -Sum).Sum; priv = ($procs | Measure-Object PrivateMemorySize64 -Sum).Sum; cpuSec = (($procs | ForEach-Object { $_.TotalProcessorTime.TotalSeconds }) | Measure-Object -Sum).Sum } | ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync("pwsh", ["-NoProfile", "-Command", ps], { encoding: "utf8" }));
}

const mib = (b) => `${(b / 1048576).toFixed(1)} MiB`;

const EXISTING = {
  permissions: { allow: ["Bash(git status)"] },
  hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
  env: { MY_UNKNOWN_VAR: "keep-me" },
  model: "opus",
  theme: "dark",
};

let app;
let mock;
let cdp;
let cdpPort;

async function launch(label) {
  cdpPort = await freePort();
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, PLUCK_DATA_DIR: dataDir, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}` };
  const t0 = performance.now();
  app = spawn(exe, [], { env, stdio: "ignore" });
  cdp = await connect(cdpPort, { timeout: 60000 });
  await cdp.waitFor("document.querySelector('[data-testid=status]') !== null", 30000);
  const ms = Math.round(performance.now() - t0);
  metric(`${label}：启动到窗口显示状态`, `${ms} ms`);
  await until(() => {
    try {
      return tray("tooltip").startsWith("Pluck ·");
    } catch {
      return false;
    }
  }, 15000, 500);
  return ms;
}

// 原生窗口是否可见：隐藏的窗口不在 UI Automation 顶层窗口中。
function windowVisible(pid) {
  const out = execFileSync("pwsh", ["-NoProfile", "-Command", `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$c = New-Object System.Windows.Automation.AndCondition((New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, 'Pluck')), (New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, ${pid})))
[bool]$A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $c)`], { encoding: "utf8" });
  return out.trim() === "True";
}

function closeWindow(pid) {
  execFileSync("pwsh", ["-NoProfile", "-Command", `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$c = New-Object System.Windows.Automation.AndCondition((New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, 'Pluck')), (New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, ${pid})))
$w = $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $c)
$w.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()`]);
}


const notice = () => cdp.evaluate("document.querySelector('[data-testid=notice]')?.innerText ?? ''");
const badge = () => cdp.evaluate("document.querySelector('[data-testid=mode-badge]').innerText");

async function clickAndWaitNotice(label, pattern, timeout = 10000) {
  await cdp.evaluate("document.querySelector('[data-testid=notice]')?.querySelector('button')?.click()");
  const t0 = performance.now();
  await cdp.click(label);
  const text = await until(async () => {
    const n = await notice();
    return pattern.test(n) ? n : null;
  }, timeout);
  return { text: text ?? (await notice()), ms: Math.round(performance.now() - t0) };
}

async function main() {
  if (!fs.existsSync(exe)) throw new Error(`找不到构建产物 ${exe}，请先运行 pnpm tauri build`);
  const osVersion = `${os.version()} ${os.release()}`;
  let cliVersion = "未安装";
  try {
    cliVersion = execFileSync(process.platform === "win32" ? "claude.exe" : "claude", ["--version"], { encoding: "utf8" }).trim();
  } catch {}
  console.log(`OS: ${osVersion}\nCLI: ${cliVersion}\n产物: ${exe}\n隔离目录: ${root}`);

  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(EXISTING, null, 2).replace(/\n/g, "\r\n") + "\r\n");
  fs.writeFileSync(credPath, JSON.stringify({ claudeAiOauth: { accessToken: "official" } }));
  const credHash = sha(credPath);

  const mockPort = await freePort();
  const base = `http://127.0.0.1:${mockPort}`;
  mock = spawn(process.execPath, [path.join(repo, "scripts", "mock-cpa.mjs"), "--port", String(mockPort), "--key", KEY_VALUE], { stdio: "ignore" });
  await until(() => fetch(`${base}/__set?models=ok`).then(() => true, () => false), 5000, 100);

  // ---- 第一次启动 ----
  await launch("首次");
  check("A1", "构建产物启动，窗口显示官方状态", (await badge()) === "官方");
  check("A1", "托盘提示显示当前状态", tray("tooltip") === "Pluck · 官方 · opus", tray("tooltip"));

  // CPA 连接。
  await cdp.fill("[data-testid=cpa-url]", base + "/");
  await cdp.fill("[data-testid=cpa-key]", KEY_VALUE);
  let r = await clickAndWaitNotice("保存连接", /CPA 连接已保存/);
  check("A2", "窗口保存 CPA 地址和 Key", /CPA 连接已保存/.test(r.text), r.text);
  const pageText = await cdp.text();
  check("A2", "窗口不回显 Key，只显示尾号", !pageText.includes(KEY_VALUE) && (await cdp.evaluate("document.querySelector('[data-testid=cpa-key]').placeholder")).includes("****"));

  // 获取列表。
  r = await clickAndWaitNotice("获取模型列表", /已获取 3 个模型/);
  check("A3", "窗口获取 CPA 模型列表", /已获取 3 个模型/.test(r.text), r.text);
  metric("获取模型列表响应", `${r.ms} ms`);
  const listText = await cdp.evaluate("document.querySelector('[data-testid=model-list]').innerText");
  check("A3", "列表显示实际模型 ID", ["gpt-5.1-codex", "qwen3-coder-plus", "deepseek-v3.2"].every((m) => listText.includes(m)));

  // 模型控件。
  await cdp.click("全选列表");
  await cdp.evaluate(`(() => { const c = [...document.querySelectorAll("label.check input")][0]; if (!c.checked) c.click(); return true; })()`);
  await cdp.choose("默认模型", "gpt-5.1-codex");
  await cdp.choose("子代理默认模型", "qwen3-coder-plus");
  await cdp.choose("haiku 别名", "deepseek-v3.2");
  await cdp.screenshot(path.join(evidence, "window-models.png"));
  r = await clickAndWaitNotice("保存模型配置", /模型配置已保存/);
  check("A4", "官方模式下保存 CPA 模型配置（切换时生效）", /切换到 CPA 时生效/.test(r.text), r.text);
  check("A4", "保存时不改官方模式的实时文件", readJson(settingsPath).model === "opus" && !readJson(settingsPath).env.ANTHROPIC_BASE_URL);

  // 窗口切到 CPA。
  r = await clickAndWaitNotice("切换到 CPA", /已切换到CPA模式/);
  let s = readJson(settingsPath);
  check("A2", "窗口切换到 CPA，写入连接与模型配置",
    s.env.ANTHROPIC_BASE_URL === base && s.model === "gpt-5.1-codex" && s.env.CLAUDE_CODE_SUBAGENT_MODEL === "qwen3-coder-plus" && s.env.ANTHROPIC_DEFAULT_HAIKU_MODEL === "deepseek-v3.2" && s.modelPicker.options.length === 3 && s.modelPicker.replaceBuiltInOptions === true);
  check("A7", "切换结果提示重开 CLI 与原生覆盖", /重新打开 Claude Code CLI/.test(r.text) && /项目级设置/.test(r.text), r.text);
  metric("窗口切换官方→CPA（点击到结果显示）", `${r.ms} ms`);
  check("A1", "窗口状态显示 CPA", (await badge()) === "CPA");
  const tip = await until(() => {
    const t = tray("tooltip");
    return t === "Pluck · CPA · gpt-5.1-codex" ? t : null;
  }, 5000, 300);
  check("A1", "托盘提示同步为 CPA", !!tip, tray("tooltip"));
  await cdp.screenshot(path.join(evidence, "window-cpa.png"));

  // 托盘菜单与切换。
  let menu = trayMenu("tray-menu-cpa.png");
  check("A1/A7", "托盘菜单显示用户级默认状态与已保存模型",
    !!menuItem(menu, "当前用户级默认：CPA") && !!menuItem(menu, "默认模型：gpt-5.1-codex") && menuItem(menu, "切换到官方")?.enabled && !menuItem(menu, "切换到 CPA")?.enabled,
    menu.map((m) => `${m.text}${m.enabled ? "" : "(不可用)"}`).join(" / "));
  let before = fs.statSync(settingsPath).mtimeMs;
  let pressed = trayClick("切换到官方");
  const changed = await until(() => fs.statSync(settingsPath).mtimeMs !== before, 10000, 20);
  metric("托盘切换 CPA→官方（点击菜单到文件写入）", `${Math.round(fs.statSync(settingsPath).mtimeMs - pressed)} ms`);
  s = readJson(settingsPath);
  check("A1/A2", "托盘切换到官方：移除 CPA 连接，恢复官方模型", changed && !s.env?.ANTHROPIC_BASE_URL && s.model === "opus" && !s.modelPicker);
  check("A1", "托盘切换后窗口同步显示官方与托盘结果", !!(await until(async () => (await badge()) === "官方" && /托盘：已切换到官方/.test(await notice()), 5000)), await notice());
  check("A1", "托盘提示同步为官方", !!(await until(() => tray("tooltip") === "Pluck · 官方 · opus", 5000, 300)), tray("tooltip"));

  before = fs.statSync(settingsPath).mtimeMs;
  pressed = trayClick("切换到 CPA");
  await until(() => fs.statSync(settingsPath).mtimeMs !== before, 10000, 20);
  metric("托盘切换 官方→CPA（点击菜单到文件写入）", `${Math.round(fs.statSync(settingsPath).mtimeMs - pressed)} ms`);
  check("A2", "托盘切回 CPA", readJson(settingsPath).env?.ANTHROPIC_BASE_URL === base);

  // 外部（CLI）保存的修改被读取。
  s = readJson(settingsPath);
  s.model = "qwen3-coder-plus";
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
  const seen = await until(async () => /qwen3-coder-plus/.test(await cdp.evaluate("document.querySelector('[data-testid=status]').innerText")), 6000);
  check("A5/A7", "外部保存的默认模型自动显示在窗口", !!seen);
  check("A5/A7", "外部保存的默认模型自动显示在托盘", !!(await until(() => tray("tooltip") === "Pluck · CPA · qwen3-coder-plus", 6000, 300)), tray("tooltip"));
  const selected = await cdp.evaluate(`[...document.querySelectorAll("label.field")].find((x) => x.querySelector(".field-label")?.textContent === "默认模型").querySelector("select").value`);
  check("A4/A5", "模型控件显示实时文件中的 Y", selected === "qwen3-coder-plus", selected);

  // 失败：获取列表失败保留原列表。
  await fetch(`${base}/__set?models=error`);
  r = await clickAndWaitNotice("刷新列表", /获取失败/);
  const kept = await cdp.evaluate("document.querySelectorAll('[data-testid=model-list] li').length");
  check("A3/A6", "刷新失败在窗口提示并保留原列表", /已保留原列表/.test(r.text) && kept === 3, r.text);
  await fetch(`${base}/__set?models=ok`);

  // 失败：只读文件（Windows 无写权限）。
  const roHash = sha(settingsPath);
  fs.chmodSync(settingsPath, 0o444);
  r = await clickAndWaitNotice("切换到官方", /失败/);
  check("A6", "窗口切换遇只读文件时提示失败且原文件不变", /写入 .* 失败，原文件未改动/.test(r.text) && sha(settingsPath) === roHash, r.text);
  await cdp.screenshot(path.join(evidence, "window-write-failure.png"));
  trayClick("切换到官方");
  await sleep(1500);
  menu = trayMenu("tray-menu-failure.png");
  check("A6", "托盘菜单显示上次操作失败原因", /^上次操作：失败：写入/.test(menuItem(menu, "上次操作")?.text ?? ""), menuItem(menu, "上次操作")?.text);
  check("A6", "托盘切换遇只读文件时原文件不变、状态仍为 CPA", sha(settingsPath) === roHash && tray("tooltip").startsWith("Pluck · CPA"));
  check("A6", "托盘失败结果同步到窗口", /托盘：.*失败/.test(await notice()), await notice());
  fs.chmodSync(settingsPath, 0o644);

  // 失败：损坏文件。
  const good = fs.readFileSync(settingsPath);
  fs.writeFileSync(settingsPath, '{ "model": ');
  await until(async () => (await badge()) === "无法读取", 6000);
  check("A6", "损坏的配置在窗口与托盘显示为无法读取", (await badge()) === "无法读取" && !!(await until(() => tray("tooltip").includes("无法读取"), 6000, 300)));
  menu = trayMenu("tray-menu-corrupt.png");
  check("A6", "损坏时托盘显示无法读取、切换项不可用，文件不被覆盖",
    !!menuItem(menu, "用户配置无法读取") && !menuItem(menu, "切换到官方")?.enabled && !menuItem(menu, "切换到 CPA")?.enabled && fs.readFileSync(settingsPath, "utf8") === '{ "model": ',
    menu.map((m) => m.text).join(" / "));
  fs.writeFileSync(settingsPath, good);
  await until(async () => (await badge()) === "CPA", 6000);

  // 关闭窗口 → 托盘常驻；托盘单击重新打开。
  closeWindow(app.pid);
  await sleep(1500);
  check("A1", "关闭窗口后窗口隐藏、Pluck 仍在托盘常驻", app.exitCode === null && !windowVisible(app.pid) && tray("tooltip").startsWith("Pluck ·"));

  tray("open");
  check("A1", "托盘单击重新打开配置窗口", !!(await until(() => windowVisible(app.pid), 5000, 300)));

  // 托盘退出，重开读回。
  cdp.close();
  trayClick("退出 Pluck");
  const exited = await until(() => app.exitCode !== null, 10000, 100);
  check("A1", "托盘“退出 Pluck”结束进程", !!exited);

  await launch("重开");
  const text = await cdp.text();
  const urlValue = await cdp.evaluate("document.querySelector('[data-testid=cpa-url]').value");
  const listAfter = await cdp.evaluate("document.querySelectorAll('[data-testid=model-list] li').length");
  check("A1", "重开后读回 CPA 模式、地址、模型与列表", (await badge()) === "CPA" && urlValue === base && /qwen3-coder-plus/.test(text) && listAfter === 3, `${urlValue}, ${listAfter}`);
  check("A1", "重开后托盘状态正确", tray("tooltip") === "Pluck · CPA · qwen3-coder-plus", tray("tooltip"));
  await cdp.screenshot(path.join(evidence, "window-reopened.png"));

  r = await clickAndWaitNotice("切换到官方", /已切换到官方模式/);
  s = readJson(settingsPath);
  check("A2", "最终切回官方：其他设置保留，凭据不变",
    JSON.stringify([s.permissions, s.hooks, s.env?.MY_UNKNOWN_VAR, s.theme, s.model]) === JSON.stringify([EXISTING.permissions, EXISTING.hooks, "keep-me", EXISTING.theme, "opus"]) && sha(credPath) === credHash);
  check("D3", "本机数据保存 Key，官方模式用户配置不含 Key", fs.readFileSync(path.join(dataDir, "state.json"), "utf8").includes(KEY_VALUE) && !fs.readFileSync(settingsPath, "utf8").includes(KEY_VALUE));
  cdp.close();
  trayClick("退出 Pluck");
  await until(() => app.exitCode !== null, 10000, 100);

  // 托盘常驻资源：不开远程调试，按正常方式启动，关闭窗口后空闲采样。
  const t1 = performance.now();
  app = spawn(exe, [], { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, PLUCK_DATA_DIR: dataDir }, stdio: "ignore" });
  await until(() => windowVisible(app.pid), 30000, 100);
  metric("正常启动到窗口出现（无远程调试）", `${Math.round(performance.now() - t1)} ms`);
  await sleep(3000);
  const open = processTree(app.pid);
  metric("窗口打开时：进程数 / 工作集 / 专用内存", `${open.count} / ${mib(open.ws)} / ${mib(open.priv)}`);
  closeWindow(app.pid);
  await sleep(30000);
  const a = processTree(app.pid);
  await sleep(10000);
  const b = processTree(app.pid);
  metric("托盘常驻（窗口关闭 30 秒后）：进程数 / 工作集 / 专用内存", `${b.count} / ${mib(b.ws)} / ${mib(b.priv)}`);
  metric("其中 pluck.exe 主进程：工作集 / 专用内存", `${mib(b.mainWs)} / ${mib(b.mainPriv)}`);
  metric("托盘常驻 CPU（10 秒采样）", `${(((b.cpuSec - a.cpuSec) / 10 / os.cpus().length) * 100).toFixed(2)}%（占 ${os.cpus().length} 个逻辑核）`);
  trayClick("退出 Pluck");
  await until(() => app.exitCode !== null, 10000, 100);
  return { osVersion, cliVersion };
}

function writeReport(meta, error) {
  const pass = results.filter((r) => r.ok).length;
  const lines = [
    "# 桌面验证报告",
    "",
    `- 时间：${new Date().toISOString()}`,
    `- 操作系统：${meta?.osVersion ?? os.version()}；${os.cpus()[0]?.model}，${os.cpus().length} 个逻辑核，内存 ${(os.totalmem() / 2 ** 30).toFixed(0)} GiB`,
    `- Claude Code：${meta?.cliVersion ?? "?"}`,
    `- 产物：${path.relative(repo, exe)}（${(fs.statSync(exe).size / 1048576).toFixed(1)} MiB）`,
    `- 结果：${pass}/${results.length} 通过${error ? `；中止：${error}` : ""}`,
    "",
    "## 检查",
    "",
    "| 验收 | 检查 | 结果 | 说明 |",
    "| --- | --- | --- | --- |",
    ...results.map((r) => `| ${r.id} | ${r.desc} | ${r.ok ? "通过" : "失败"} | ${r.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`),
    "",
    "## 观测",
    "",
    "| 项目 | 数值 |",
    "| --- | --- |",
    ...metrics.map((m) => `| ${m.name} | ${m.value} |`),
    "",
  ];
  fs.writeFileSync(reportPath, lines.join("\n"));
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
  try {
    cdp?.close();
  } catch {}
  if (app && app.exitCode === null) app.kill();
  mock?.kill();
  await sleep(500);
  try {
    fs.chmodSync(settingsPath, 0o644);
  } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
const ok = writeReport(meta, failure);
console.log(`${ok ? "全部通过" : "存在失败"}；报告：${reportPath}`);
process.exit(ok ? 0 : 1);
