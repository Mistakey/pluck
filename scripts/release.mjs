// Explicit release entry points, shared by the workflow and local validation.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function versions(root = ".") {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
  const config = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json")));
  const cargo = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
  return [pkg.version, config.version, cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1]];
}

export function validateVersion(version, actual = versions()) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Release version must be a stable x.y.z without a v prefix");
  if (actual.some(v => v !== version))
    throw new Error(`Version mismatch: requested=${version}, package/tauri/cargo=${actual.join("/")}`);
}

function repository(value) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(value ?? "")) throw new Error("Set GITHUB_REPOSITORY to owner/repository");
  return value;
}

function notes(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) throw new Error("Release notes must not be empty");
  return text;
}

const digest = data => createHash("sha256").update(data).digest("hex");
const work = path.resolve(".forge/tmp/release");
const artifacts = path.join(work, "artifacts");
const names = version => [`Pluck_${version}_x64-setup.exe`, `Pluck_${version}_x64-setup.exe.sig`, "latest.json", "build-info.json", "SHA256SUMS.txt"];

export function validateAssets(directory, version) {
  const expected = names(version);
  const found = fs.readdirSync(directory).sort();
  if (JSON.stringify(found) !== JSON.stringify([...expected].sort())) throw new Error("Release asset set is incomplete or unexpected");
  const info = JSON.parse(fs.readFileSync(path.join(directory, "build-info.json")));
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "latest.json")));
  if (info.version !== version || manifest.version !== version || !/^[a-f0-9]{40}$/.test(info.commit)) throw new Error("Release provenance mismatch");
  for (const name of expected.slice(0, 3)) {
    if (digest(fs.readFileSync(path.join(directory, name))) !== info.files[name]) throw new Error(`Release checksum mismatch: ${name}`);
  }
  const sums = expected.slice(0, 4).map(name => `${digest(fs.readFileSync(path.join(directory, name)))}  ${name}`).join("\n") + "\n";
  if (fs.readFileSync(path.join(directory, "SHA256SUMS.txt"), "utf8") !== sums) throw new Error("Release checksum list mismatch");
  const platform = manifest.platforms?.["windows-x86_64"];
  const expectedUrl = `https://github.com/${repository(info.repository)}/releases/download/v${version}/${expected[0]}`;
  if (platform?.url !== expectedUrl || platform.signature !== fs.readFileSync(path.join(directory, expected[1]), "utf8").trim()) throw new Error("Updater metadata does not match the installer");
  return info;
}

export function publish(directory, version, repo, notesFile, gh) {
  const info = validateAssets(directory, version);
  if (info.repository !== repo) throw new Error("Release repository mismatch");
  const tag = `v${version}`;
  const refs = JSON.parse(gh(["api", `repos/${repo}/git/matching-refs/tags/${tag}`]));
  if (refs.some(ref => ref.ref === `refs/tags/${tag}`)) throw new Error("Release tag already exists; never repoint an existing version");
  // No clobber: reruns cannot mutate a version clients have already seen.
  gh(["release", "create", tag, "--repo", repo, "--draft", "--target", info.commit, "--title", tag, "--notes-file", notesFile]);
  gh(["release", "upload", tag, "--repo", repo, ...names(version).map(name => path.join(directory, name))]);
  const download = fs.mkdtempSync(path.join(path.dirname(directory), "uploaded-"));
  try {
    gh(["release", "download", tag, "--repo", repo, "--dir", download]);
    const remote = validateAssets(download, version);
    if (JSON.stringify(remote) !== JSON.stringify(info)) throw new Error("Uploaded release differs from the checked build");
    // Draft stays invisible until every asset has been uploaded and read back.
    gh(["release", "edit", tag, "--repo", repo, "--draft=false", "--latest"]);
  } finally {
    fs.rmSync(download, { recursive: true, force: true });
  }
}

export function run(command, env = process.env) {
  const version = env.RELEASE_VERSION;
  validateVersion(version);
  const releaseNotes = notes(env.RELEASE_NOTES_FILE);
  if (command === "check") return;
  const repo = repository(env.GITHUB_REPOSITORY);
  if (command === "prepare") {
    const key = env.UPDATER_PUBLIC_KEY?.trim();
    if (!key || !Buffer.from(key, "base64").toString("utf8").includes("minisign public key")) throw new Error("Set UPDATER_PUBLIC_KEY to the Tauri signing public key");
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(path.join(work, "tauri.conf.json"), JSON.stringify({
      plugins: { updater: { pubkey: key, endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`] } },
    }, null, 2));
    return;
  }
  if (command === "metadata") {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
    const [exe, sig] = names(version);
    const source = path.resolve(env.RELEASE_BUNDLE_DIR ?? "src-tauri/target/release/bundle/nsis");
    const installer = fs.readFileSync(path.join(source, exe));
    const signature = fs.readFileSync(path.join(source, sig));
    if (installer.length < 2 || installer.subarray(0, 2).toString() !== "MZ" || !signature.toString().trim()) throw new Error("Missing installer or signature");
    if (fs.existsSync(artifacts) && fs.readdirSync(artifacts).length) throw new Error("Release artifacts directory must be empty; use a fresh checkout or remove only .forge/tmp/release/artifacts");
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, exe), installer);
    fs.writeFileSync(path.join(artifacts, sig), signature);
    fs.writeFileSync(path.join(artifacts, "latest.json"), JSON.stringify({
      version, notes: releaseNotes, pub_date: new Date().toISOString(),
      platforms: { "windows-x86_64": { signature: signature.toString().trim(), url: `https://github.com/${repo}/releases/download/v${version}/${exe}` } },
    }, null, 2));
    const files = Object.fromEntries(names(version).slice(0, 3).map(name => [name, digest(fs.readFileSync(path.join(artifacts, name)))]));
    fs.writeFileSync(path.join(artifacts, "build-info.json"), JSON.stringify({ version, commit, repository: repo, files }, null, 2));
    fs.writeFileSync(path.join(artifacts, "SHA256SUMS.txt"), names(version).slice(0, 4).map(name => `${digest(fs.readFileSync(path.join(artifacts, name)))}  ${name}`).join("\n") + "\n");
    validateAssets(artifacts, version);
    return;
  }
  if (command === "publish") {
    const gh = args => execFileSync("gh", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    publish(artifacts, version, repo, env.RELEASE_NOTES_FILE, gh);
    return;
  }
  throw new Error(`Unknown release command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) run(process.argv[2]);
