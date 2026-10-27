// Windows 资源测量：生产后台与窗口工厂，隔离数据，全程隐藏、不操作桌面。
// pnpm measure:resources [--report path.md]
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("此测量入口使用 Windows 进程计数器");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const report = args.includes("--report") ? path.resolve(args[args.indexOf("--report") + 1]) : null;
// 先构建前端，再编译 release 测量程序，避免开发模式影响内存。
execFileSync("cmd.exe", ["/d", "/c", "pnpm build"], { cwd: repo, stdio: "inherit", windowsHide: true });
execFileSync("cargo", ["build", "--release", "--example", "resources", "--manifest-path", "src-tauri/Cargo.toml"], {
  cwd: repo, stdio: "inherit", windowsHide: true,
});
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pluck-resources-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC|PLUCK|WEBVIEW2)/i.test(k)));
env.CLAUDE_CONFIG_DIR = path.join(root, "claude");
env.PLUCK_DATA_DIR = path.join(root, "data");
env.WEBVIEW2_USER_DATA_FOLDER = path.join(root, "webview");
const samples = [];
const probe = spawn(path.join(repo, "src-tauri/target/release/examples/resources.exe"), [], {
  cwd: repo, env, stdio: ["pipe", "pipe", "inherit"], windowsHide: true, timeout: 240000,
});
const exited = new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.once("exit", resolve);
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sample() {
  // 只读取 PID、父子关系和资源计数器，不读取进程命令行或用户配置。
  const script = `
$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId
$ids = [System.Collections.Generic.List[int]]::new()
$ids.Add(${probe.pid})
do {
  $count = $ids.Count
  foreach ($item in $all) {
    if ($ids.Contains([int]$item.ParentProcessId) -and -not $ids.Contains([int]$item.ProcessId)) { $ids.Add([int]$item.ProcessId) }
  }
} while ($ids.Count -ne $count)
$procs = @(Get-Process -Id $ids -ErrorAction SilentlyContinue)
[pscustomobject]@{
  processes = $procs.Count
  privateMiB = [math]::Round(($procs | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB, 1)
  workingSetMiB = [math]::Round(($procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB, 1)
  cpuSeconds = ($procs | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum
} | ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true,
  }));
}

let failure;
try {
  for await (const line of createInterface({ input: probe.stdout })) {
    if (!line.startsWith("{")) continue;
    const stage = JSON.parse(line);
    await sleep(stage.stage === "open" ? 3000 : 1000);
    let current = sample();
    if (stage.stage !== "open") {
      const deadline = Date.now() + 30000;
      while (current.processes > 1 && Date.now() < deadline) {
        await sleep(500);
        current = sample();
      }
    }
    const before = current;
    await sleep(2000);
    current = sample();
    const row = { ...stage, ...current, cpuSecondsDuringIdle: +(current.cpuSeconds - before.cpuSeconds).toFixed(3) };
    samples.push(row);
    console.log(JSON.stringify(row));
    if (stage.stage !== "open" && current.processes !== 1) throw new Error("关闭后 WebView 子进程未回收");
    probe.stdin.write("next\n");
  }
  const exitCode = await exited;
  if (exitCode !== 0 || samples.length !== 11) throw new Error(`资源测量未完整结束（退出码 ${exitCode}，${samples.length}/11 个样本）`);
} catch (e) {
  failure = e;
} finally {
  if (probe.exitCode === null) {
    execFileSync("taskkill.exe", ["/pid", String(probe.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
  }
  await exited;
  fs.rmSync(root, { recursive: true, force: true });
}
if (report) {
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, [
    "# 常驻资源测量", "", `时间：${new Date().toISOString()}。Windows release 产物，窗口全程隐藏，无远程调试；独立配置与 WebView 目录。`, "",
    "| 阶段 | 轮次 | 进程数 | 专用内存 MiB | 工作集 MiB | 2 秒空闲 CPU 时间（秒） | 窗口创建/关闭请求 ms |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...samples.map((s) => `| ${s.stage} | ${s.cycle} | ${s.processes} | ${s.privateMiB} | ${s.workingSetMiB} | ${s.cpuSecondsDuringIdle} | ${s.elapsedMs} |`),
    "", "创建时间不等于可交互时间；短期反复开关只能检查资源是否回收及明显累积，不能证明永远不存在泄漏。",
    ...(failure ? ["", `失败：${failure.message}`] : []), "",
  ].join("\n"));
}
if (failure) throw failure;
