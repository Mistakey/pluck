import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { versions, validateVersion, validateAssets, publish } from "./release.mjs";

test("release rejects version mismatch and non-stable versions", () => {
  validateVersion(versions()[0]);
  validateVersion("0.2.0", ["0.2.0", "0.2.0", "0.2.0"]);
  assert.throws(() => validateVersion("0.3.0", ["0.2.0", "0.3.0", "0.3.0"]), /mismatch/);
  for (const value of ["v0.2.0", "0.2.0-beta.1", "0.02.0", "0.2.0\nrun code"])
    assert.throws(() => validateVersion(value), /stable/);
});

function assets(root) {
  const dir = path.join(root, "artifacts");
  fs.mkdirSync(dir);
  const exe = "Pluck_0.2.0_x64-setup.exe";
  fs.writeFileSync(path.join(dir, exe), "MZ test fixture");
  fs.writeFileSync(path.join(dir, `${exe}.sig`), "test signature");
  fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify({
    version: "0.2.0", platforms: { "windows-x86_64": { signature: "test signature", url: `https://github.com/test/pluck/releases/download/v0.2.0/${exe}` } },
  }));
  const names = [exe, `${exe}.sig`, "latest.json", "build-info.json"];
  const hash = name => createHash("sha256").update(fs.readFileSync(path.join(dir, name))).digest("hex");
  fs.writeFileSync(path.join(dir, "build-info.json"), JSON.stringify({ version: "0.2.0", repository: "test/pluck", commit: "a".repeat(40), files: Object.fromEntries(names.slice(0, 3).map(n => [n, hash(n)])) }));
  fs.writeFileSync(path.join(dir, "SHA256SUMS.txt"), names.map(n => `${hash(n)}  ${n}`).join("\n") + "\n");
  return dir;
}

test("publishing stays draft on upload failure or incomplete readback; complete artifacts publish once", () => {
  fs.mkdirSync(".forge/tmp", { recursive: true });
  const root = fs.mkdtempSync(path.resolve(".forge/tmp/release-test-"));
  try {
    const dir = assets(root);
    for (const failure of ["upload", "missing", "corrupt", null]) {
      let published = false, drafted = false;
      const gh = args => {
        if (args[0] === "api") return "[]";
        if (args[1] === "create") { assert(args.includes("--draft")); drafted = true; }
        if (args[1] === "upload" && failure === "upload") throw new Error("upload unavailable");
        if (args[1] === "download") {
          const dest = args[args.indexOf("--dir") + 1];
          for (const name of fs.readdirSync(dir)) {
            if (failure === "missing" && name === "latest.json") continue;
            fs.copyFileSync(path.join(dir, name), path.join(dest, name));
          }
          if (failure === "corrupt") fs.appendFileSync(path.join(dest, "Pluck_0.2.0_x64-setup.exe"), "tampered");
        }
        if (args[1] === "edit") { assert(drafted); published = true; }
        return "";
      };
      const action = () => publish(dir, "0.2.0", "test/pluck", "notes.md", gh);
      if (failure) { assert.throws(action); assert.equal(published, false); }
      else { action(); assert.equal(published, true); }
    }
    assert.throws(() => publish(dir, "0.2.0", "test/pluck", "notes.md", () => JSON.stringify([{ ref: "refs/tags/v0.2.0" }])), /tag already exists/);
    fs.unlinkSync(path.join(dir, "latest.json"));
    assert.throws(() => validateAssets(dir, "0.2.0"), /incomplete/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("only an explicit workflow dispatch can publish", () => {
  const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(workflow, /on:\s*\n\s+workflow_dispatch:/);
  const triggers = workflow.split("on:\n")[1].split("\npermissions:")[0];
  assert.doesNotMatch(triggers, /^\s+(push|pull_request|release|schedule):/m);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
});
