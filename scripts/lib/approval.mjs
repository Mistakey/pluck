// Real CLI auto permission checks. All API calls use the local CPA replacement;
// the only executed tool sends a POST back to that same isolated server.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export async function verifyApproval({ cli, env, project, root, base, mockLog, pluck, settings, check, evidence }) {
  await fetch(`${base}/__set?approval=true`);
  const original = fs.readFileSync(settings, "utf8");
  const readLog = () => fs.readFileSync(mockLog, "utf8").trim().split("\n").map(JSON.parse);
  try {
    for (const [name, model] of [["selected", "qwen3-coder-plus"], ["default", null], ["ignored", "claude-opus-5"]]) {
      const view = pluck("models");
      pluck("set-models", JSON.stringify({ ...view.config, defaultModel: "gpt-5.1-codex", autoModeModel: model }));
      const log = path.join(root, `approval-${name}.log`);
      const before = readLog().length;
      const result = await new Promise((resolve, reject) => {
        const proc = spawn(cli, ["-p", "Send one verification POST to the local approval-proof endpoint using Bash curl.",
          "--permission-mode", "auto", "--max-turns", "3", "--debug-file", log], {
          cwd: project, env: { ...env, DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1" },
          windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        proc.stdout.on("data", (s) => output += s);
        proc.stderr.on("data", (s) => output += s);
        const timer = setTimeout(() => proc.kill(), 60000);
        proc.on("error", reject);
        proc.on("close", (code) => { clearTimeout(timer); resolve({ code, output }); });
      });
      if (result.code !== 0) throw new Error(`自动审批 ${name} 失败：${result.output.slice(-1500)}`);
      const debug = fs.readFileSync(log, "utf8");
      const lines = debug.split("\n").filter((s) => s.includes("classifier_request_started"));
      const actual = lines.map((s) => / model=(\S+)/.exec(s)?.[1]);
      const requests = readLog().slice(before);
      const classifiers = requests.filter((r) => r.classifier);
      evidence.push(...debug.split("\n").filter((s) => s.includes("ignoring CLAUDE_CODE_AUTO_MODE_MODEL") ||
        s.includes("the platform gave no classification")), "");
      check(`${name}：真实自动审批已完成，日志模型与 CPA 实收模型一致`, actual.length > 0 &&
        classifiers.length === actual.length && classifiers.every((r, i) => r.auth && r.model === actual[i]) &&
        requests.some((r) => r.path === "/approval-proof"));
      if (name === "selected") check("选定 CPA 审批模型实际生效", actual.every((id) => id === model));
      if (name === "ignored") check("CLI 对不支持的审批模型给出忽略原因并使用默认", debug.includes("ignoring CLAUDE_CODE_AUTO_MODE_MODEL") && actual.every((id) => id !== model));
      evidence.push(`自动审批 ${name}：` + actual.join(", ") + "；请求到达本地 CPA 替身，审批后执行了本地 POST。", "```text",
        ...lines.map((s) => s.replace(/reqId=\S+/, "reqId=<isolated>")),
        ...classifiers.map(({ path, model, auth }) => JSON.stringify({ path, model, auth })), "```", "");
    }
  } finally {
    fs.writeFileSync(settings, original);
  }
}
