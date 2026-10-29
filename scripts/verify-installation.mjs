// Real installers and the production UI, on an expendable hosted Windows VM only.
// Never run this against a person's Windows profile or desktop.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { publish, validateAssets, validateVersion } from "./release.mjs";

assert.equal(process.platform, "win32");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted", "Use an expendable hosted VM, never a personal/self-hosted machine");
const version = process.env.RELEASE_VERSION;
validateVersion(version);
assert.match(process.env.BUILD_RUN ?? "", /^\d+$/);
const repo = process.env.GITHUB_REPOSITORY;
assert.equal(repo, "Mistakey/pluck");
const previousVersion = "0.2.0";
const diagnosticOnly = process.env.DIAGNOSE_ONLY === "true";
const root = path.resolve(".forge/tmp/installation");
assert(!fs.existsSync(root), "Use a fresh hosted VM for every verification");
const evidence = path.join(root, "evidence");
fs.mkdirSync(evidence, { recursive: true });
const report = { startedAt: new Date().toISOString(), repository: repo, run: process.env.GITHUB_RUN_ID, candidateBuild: process.env.BUILD_RUN, diagnosticOnly, checks: [] };
const save = () => fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify(report, null, 2));
const record = (name, detail) => { report.checks.push({ name, at: new Date().toISOString(), ...detail }); save(); console.log(`PASS ${name}`); };
const gh = args => execFileSync("gh", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
const ps = code => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; ${code}`], { encoding: "utf8", windowsHide: true }).trim();
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(description, check, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch (e) { last = e; }
    await wait(500);
  }
  throw new Error(`Timed out: ${description}${last ? ` (${last.message})` : ""}`);
}
function processes() {
  return JSON.parse(ps("ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter \"Name='pluck.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate)"));
}
function stopApps() {
  // This VM was checked empty before any Pluck process was created.
  for (const p of processes()) process.kill(p.ProcessId);
}
function start(executable, args = []) {
  const child = spawn(executable, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of ["stdout", "stderr"]) child[stream].on("data", bytes => fs.appendFileSync(path.join(evidence, `process-${child.pid}-${stream}.log`), bytes));
  child.on("error", error => { report.processError = error.message; save(); });
  return child;
}
async function install(file, args) {
  const child = start(file, args);
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("Installer timed out")); }, 120000);
    child.once("error", reject);
    child.once("exit", code => { clearTimeout(timer); resolve(code); });
  });
}
const claude = path.join(root, "claude"), data = path.join(root, "data");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLAUDE|ANTHROPIC|PLUCK|WEBVIEW2)/i.test(key)));
Object.assign(env, {
  CLAUDE_CONFIG_DIR: claude, PLUCK_DATA_DIR: data,
  WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
});
const files = [path.join(data, "state.json"), path.join(claude, "settings.json"), path.join(claude, ".credentials.json")];
let baseline, ownsVm = false;
const preserved = () => {
  const current = Object.fromEntries(files.map(file => [path.basename(file), hash(file)]));
  assert.deepEqual(current, baseline, "CPA connection/key, cached list/timestamp, snapshots, Claude settings and credentials must remain byte-identical");
  return current;
};
function ui(pid, executable, action = "read", name = "") {
  const result = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", path.resolve("scripts/lib/installed-ui.ps1")], {
    encoding: "utf8", windowsHide: true, timeout: 20000,
    env: { ...process.env, PLUCK_UIA_PID: String(pid), PLUCK_UIA_EXE: executable, PLUCK_UIA_ACTION: action, PLUCK_UIA_NAME: name },
  }));
  if (action === "read") fs.writeFileSync(path.join(evidence, `ui-${pid}.json`), JSON.stringify(result, null, 2));
  return result;
}
const names = elements => elements.map(e => e.name).join("\n");
async function view(pid, executable, expected) {
  return until(`installed application UI: ${expected}`, () => {
    const snapshot = ui(pid, executable);
    // WebView accessibility exposes the label and interpolated version as separate text nodes.
    return names(snapshot).replace(/\s+/g, "").includes(expected.replace(/\s+/g, "")) ? snapshot : null;
  });
}
async function click(pid, executable, name) {
  return until(`application button ${name}`, () => ui(pid, executable, "click", name));
}
const latestUrl = `https://github.com/${repo}/releases/latest/download/latest.json`;
async function latest() {
  const response = await fetch(latestUrl, { headers: { "Cache-Control": "no-cache" } });
  assert.equal(response.status, 200);
  return await response.json();
}
try {
  assert.deepEqual(processes(), [], "Hosted VM must not already be running Pluck");
  assert.equal(ps("Test-Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Pluck'"), "False");
  ownsVm = true;
  const previous = path.join(root, "previous"), candidate = path.join(root, "candidate");
  fs.mkdirSync(previous); fs.mkdirSync(candidate);
  gh(["release", "download", `v${previousVersion}`, "--repo", repo, "--dir", previous]);
  gh(["run", "download", process.env.BUILD_RUN, "--repo", repo, "--name", `signed-release-${version}`, "--dir", candidate]);
  gh(["run", "download", process.env.BUILD_RUN, "--repo", repo, "--name", `installed-binary-${version}`, "--dir", path.join(root, "binary")]);
  const previousInfo = validateAssets(previous, previousVersion), candidateInfo = validateAssets(candidate, version);
  report.artifacts = { previous: previousInfo, candidate: candidateInfo };
  // Verification-script/document repairs need not rebuild an unchanged production binary.
  // Pin the candidate's own build, then require identical production sources in this verifier.
  execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", candidateInfo.commit], { windowsHide: true, stdio: "pipe" });
  execFileSync("git", ["diff", "--exit-code", candidateInfo.commit, "HEAD", "--", "src", "src-tauri", "package.json", "pnpm-lock.yaml", "scripts/release.mjs"], { windowsHide: true, stdio: "pipe" });
  report.verifierCommit = process.env.GITHUB_SHA;
  const build = JSON.parse(gh(["run", "view", process.env.BUILD_RUN, "--repo", repo, "--json", "conclusion,headSha"]));
  assert.equal(build.conclusion, "success"); assert.equal(build.headSha, candidateInfo.commit);
  assert.equal((await latest()).version, previousVersion);
  for (const dir of ["claude", "data"]) fs.cpSync(path.resolve("docs/verification/fixtures/legacy-cpa", dir), path.join(root, dir), { recursive: true });
  baseline = Object.fromEntries(files.map(file => [path.basename(file), hash(file)]));
  record("downloaded signed real artifacts and copied legacy data", { previousInfo, candidateInfo, dataHashes: baseline });

  const installedDir = path.join(process.env.LOCALAPPDATA, "Pluck");
  const installedExe = path.join(installedDir, "pluck.exe");
  const installer = path.join(previous, `Pluck_${previousVersion}_x64-setup.exe`);
  if (!diagnosticOnly) {
  const portable = path.resolve(".forge/tmp/portable-source/src-tauri/target/release/pluck.exe");
  const portableProcess = start(portable, ["--hidden"]);
  await until("old portable process", () => processes().find(p => p.ProcessId === portableProcess.pid));
  await wait(3000);
  assert.equal(portableProcess.exitCode, null);
  const portableBefore = processes();
  const installExit = await install(installer, ["/S", `/D=${installedDir}`]);
  const afterInstall = processes();
  record("actual installer while the existing portable process runs", { portableCommit: "d6cca12", portableSha256: hash(portable), portableBefore, installExit, afterInstall });
  // A running portable instance may block or receive the installed program's single-instance request.
  // The supported migration explicitly exits that instance before launching the installation.
  if (installExit !== 0) {
    stopApps();
    assert.equal(await install(installer, ["/S", `/D=${installedDir}`]), 0);
  }
  assert(fs.existsSync(installedExe));
  let activePortable = portableProcess;
  if (!processes().some(p => p.ProcessId === activePortable.pid)) {
    // Also cover an old portable shortcut launched after installation, even when NSIS
    // successfully terminated the first old process during the install.
    stopApps();
    activePortable = start(portable, ["--hidden"]);
    await until("portable instance restarted after installation", () => processes().some(p => p.ProcessId === activePortable.pid));
    await wait(3000);
    assert.equal(activePortable.exitCode, null);
  }
  const second = start(installedExe, ["--hidden"]);
  await until("installed launch forwarded to portable single instance", () => second.exitCode !== null);
  assert.equal(second.exitCode, 0);
  assert(processes().some(p => p.ProcessId === activePortable.pid));
  record("portable single-instance forwarding observed", { portablePid: activePortable.pid, installedLaunchPid: second.pid, installedLaunchExit: second.exitCode });
  stopApps();
  await until("portable instance stopped", () => processes().length === 0);
  } else {
    assert.equal(await install(installer, ["/S", `/D=${installedDir}`]), 0);
  }
  const installedProcess = start(installedExe);
  await wait(3000);
  record("installed process startup", { pid: installedProcess.pid, exitCode: installedProcess.exitCode, processes: processes(), dataHashes: preserved() });
  await view(installedProcess.pid, installedExe, "CPA");
  await click(installedProcess.pid, installedExe, "^设置");
  const before = await view(installedProcess.pid, installedExe, `当前版本 ${previousVersion}`);
  const registry = ps("Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Pluck' | Select-Object InstallLocation,MainBinaryName,DisplayVersion | ConvertTo-Json -Compress");
  report.beforeUpdate = { pid: installedProcess.pid, binarySha256: hash(installedExe), status: before, registry: JSON.parse(registry), processes: processes() };
  record(diagnosticOnly ? "installed application diagnostics" : "portable-to-current-user installation preserved all legacy data", { dataHashes: preserved(), currentVersion: previousVersion, ui: before });

  if (!diagnosticOnly) {
  const notes = path.join(root, "notes.txt");
  fs.writeFileSync(notes, JSON.parse(fs.readFileSync(path.join(candidate, "latest.json"))).notes);
  // Use the production publication function and real GitHub API. Omit one uploaded asset to
  // reproduce an interrupted upload, then let production readback reject the incomplete draft.
  assert.throws(() => publish(candidate, version, repo, notes, args => {
    if (args[0] === "release" && args[1] === "upload") args = args.filter(a => a !== path.join(candidate, "latest.json"));
    return gh(args);
  }), /incomplete/);
  const draft = JSON.parse(gh(["release", "view", `v${version}`, "--repo", repo, "--json", "isDraft,assets,url"]));
  assert.equal(draft.isDraft, true); assert.equal(draft.assets.length, 4);
  assert.equal((await latest()).version, previousVersion);
  await click(installedProcess.pid, installedExe, "^检查更新$");
  const afterFailure = await view(installedProcess.pid, installedExe, "已是最新版本");
  assert(!names(afterFailure).includes(`发现新版 ${version}`));
  record("incomplete real draft not announced to the actual installed client", { draft, latestVersion: previousVersion, client: afterFailure });
  gh(["release", "delete", `v${version}`, "--repo", repo, "--cleanup-tag", "--yes"]);
  publish(candidate, version, repo, notes, gh);
  await until("new public release manifest", async () => (await latest()).version === version, 120000);
  await click(installedProcess.pid, installedExe, "^检查更新$");
  const available = await view(installedProcess.pid, installedExe, `发现新版 ${version}`);
  record("fully published version discovered by actual installed client", { client: available });
  await click(installedProcess.pid, installedExe, "^更新并重启$");
  // The real UI requests the real backend, which downloads/verifies the package, starts NSIS
  // and exits. No IPC response or installer is stubbed. Inspect only the new process's window.
  await until("updater exits previous process", () => !processes().some(p => p.ProcessId === installedProcess.pid), 180000);
  await until("NSIS replaces binary and restarts installed application", () => {
    return hash(installedExe) !== report.beforeUpdate.binarySha256 && processes().some(p => p.ExecutablePath?.toLowerCase() === installedExe.toLowerCase());
  }, 180000);
  const restarted = processes().find(p => p.ExecutablePath?.toLowerCase() === installedExe.toLowerCase());
  await click(restarted.ProcessId, installedExe, "^设置");
  const after = await view(restarted.ProcessId, installedExe, `当前版本 ${version}`);
  assert.equal(hash(installedExe), fs.readFileSync(path.join(root, "binary/binary.sha256"), "utf8").trim());
  report.afterUpdate = { status: after, binarySha256: hash(installedExe), processes: processes(), registry: JSON.parse(ps("Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Pluck' | Select-Object InstallLocation,MainBinaryName,DisplayVersion | ConvertTo-Json -Compress")) };
  record("real in-app NSIS replacement and restart preserved every legacy data file", { fromVersion: previousVersion, toVersion: version, dataHashes: preserved() });
  }
  report.finishedAt = new Date().toISOString(); report.passed = true; save();
} catch (error) {
  report.passed = false; report.error = error.stack; save();
  report.failureProcesses = processes();
  report.webviewProcesses = JSON.parse(ps("ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object Name -Like '*webview*' | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine)"));
  save();
  throw error;
} finally {
  if (ownsVm) stopApps();
  // The hosted VM is discarded after the job. Evidence contains hashes/process paths only,
  // never the copied settings, test credentials or signing material.
}
