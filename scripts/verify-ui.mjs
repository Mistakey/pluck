// Headless checks against the built production UI. Only the IPC boundary is replaced;
// no native window, user configuration, pointer, or tray is accessed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const out = path.resolve(".forge/tmp/ui");
fs.mkdirSync(out, { recursive: true });
const results = [];
const clone = (value) => structuredClone(value);
const empty = {
  defaultModel: null,
  subagentModel: null,
  autoModeModel: null,
  aliasOpus: null,
  aliasSonnet: null,
  aliasHaiku: null,
  pickerModels: [],
  replaceBuiltIn: false,
};
const config = {
  ...empty,
  defaultModel: "legacy-outside-list",
  subagentModel: "model-b",
  aliasOpus: "model-a",
  aliasSonnet: "model-b",
  aliasHaiku: "legacy-haiku",
  pickerModels: ["model-a", "legacy-outside-list"],
  replaceBuiltIn: true,
};
const catalog = Array.from({ length: 35 }, (_, i) => ({
  id: i === 0 ? "model-a" : i === 1 ? "model-b" : `provider-long-model-id-${i}`,
  displayName: i === 0 ? "Alpha" : `Model ${i}`,
}));
const status = {
  mode: "cpa",
  modeLabel: "CPA",
  error: null,
  otherBaseUrl: null,
  configDir: "C:\\isolated\\claude",
  settingsPath: "C:\\isolated\\claude\\settings.json",
  settingsExists: true,
  credentialsPresent: true,
  cpaConfigured: true,
  cpaBaseUrl: "http://127.0.0.1:18318",
  cpaKeyHint: "****1234",
  connectionRevision: "c1",
  model: config.defaultModel,
  subagentModel: config.subagentModel,
  aliases: {
    opus: config.aliasOpus,
    sonnet: config.aliasSonnet,
    haiku: config.aliasHaiku,
  },
  pickerCount: 2,
  processEnv: [],
  dataPath: "C:\\isolated\\data\\state.json",
};
const server = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = path.resolve("dist", name === "/" ? "index.html" : `.${name}`);
  if (!file.startsWith(path.resolve("dist") + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = fs.readFileSync(file);
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
let page, backend;
async function boot(options = {}) {
  if (page) await page.close();
  backend = {
    status: clone(status),
    view: {
      config: clone(config),
      revision: "r1",
      source: "live",
      models: clone(catalog),
      fetchedAt: 1760000000,
    },
    calls: [],
    destroyed: 0,
    fail: null,
    defer: null,
    ...options,
  };
  page = await browser.newPage({
    viewport: { width: 1040, height: 688 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (e) => {
    throw e;
  });
  await page.exposeBinding("testIPC", async (_source, cmd, args) => {
    backend.calls.push({ cmd, args: clone(args) });
    if (backend.defer?.cmd === cmd) {
      const d = backend.defer;
      backend.defer = null;
      d.started?.();
      return d.promise;
    }
    if (backend.real) return backend.real(cmd, args);
    if (backend.fail === cmd) throw new Error(`模拟 ${cmd} 失败，输入已保留`);
    switch (cmd) {
      case "get_status":
        return clone(backend.status);
      case "get_models":
        return clone(backend.view);
      case "refresh_models":
        return clone(backend.view);
      case "save_cpa": {
        if (args.revision !== backend.status.connectionRevision)
          throw new Error("连接冲突");
        const beforeModelRevision = backend.view.revision;
        backend.status.cpaBaseUrl = args.baseUrl;
        backend.status.cpaConfigured = true;
        backend.status.connectionRevision += "x";
        backend.view.revision += "c";
        return {
          message: "CPA 连接已保存",
          status: clone(backend.status),
          beforeModelRevision,
          modelView: clone(backend.view),
        };
      }
      case "save_model_config":
        if (args.revision !== backend.view.revision)
          throw new Error("模型 revision 冲突");
        backend.view.config = clone(args.config);
        backend.view.revision += "s";
        return { message: "模型配置已保存", status: clone(backend.status) };
      case "switch_mode":
        backend.status.mode = args.mode;
        backend.view.source = args.mode === "cpa" ? "live" : "saved";
        backend.view.revision += "m";
        return { message: "已切换", status: clone(backend.status) };
      case "plugin:window|destroy":
        backend.destroyed++;
        return;
      default:
        throw new Error(`未处理 IPC ${cmd}`);
    }
  });
  await page.addInitScript(() => {
    const callbacks = new Map(),
      listeners = new Map();
    let next = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: (fn) => {
        const id = ++next;
        callbacks.set(id, fn);
        return id;
      },
      unregisterCallback: (id) => callbacks.delete(id),
      invoke: async (cmd, args) => {
        if (cmd === "plugin:event|listen") {
          listeners.set(args.handler, args.event);
          return args.handler;
        }
        if (cmd === "plugin:event|unlisten") {
          listeners.delete(args.eventId);
          return;
        }
        return window.testIPC(cmd, args);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event, id) => {
        listeners.delete(id);
        callbacks.delete(id);
      },
    };
    window.__testEmit = async (event) => {
      for (const [id, name] of listeners)
        if (name === event)
          await callbacks.get(id)?.({ event, id, payload: null });
    };
  });
  await page.goto(url);
  await page
    .getByRole("button", { name: "编辑连接", exact: true })
    .or(page.getByRole("button", { name: "配置连接", exact: true }).first())
    .waitFor();
  await poll(() => backend.calls.some((c) => c.cmd === "get_models"));
}
async function poll(fn) {
  const until = Date.now() + 5000;
  while (!(await fn())) {
    if (Date.now() > until) throw new Error("检查超时");
    await new Promise((r) => setTimeout(r, 20));
  }
}
const button = (name) =>
  page.getByRole("button", {
    name: name === "Claude Code" ? /^Claude Code/ : name,
    exact: true,
  });
const field = (name) => page.getByLabel(name, { exact: true });
async function chosen(name, value) {
  assert.equal(await field(name).inputValue(), value);
}
async function emit() {
  await page.evaluate(() => window.__testEmit("status-changed"));
  await new Promise((r) => setTimeout(r, 50));
}
async function dirty() {
  await field("默认模型").selectOption("model-b");
}
async function test(name, fn) {
  await fn();
  results.push(name);
  console.log(`PASS ${name}`);
}
async function layout(name, width, height) {
  await page.setViewportSize({ width, height });
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    footer: document.querySelector(".editor-footer").getBoundingClientRect()
      .bottom,
    catalog: document.querySelector(".model-rows").getBoundingClientRect(),
    scrollable:
      document.querySelector(".model-rows").scrollHeight >
      document.querySelector(".model-rows").clientHeight,
  }));
  assert.equal(dimensions.scroll, width);
  assert(dimensions.footer <= height);
  assert(dimensions.scrollable);
  assert.equal(
    await page
      .getByRole("navigation", { name: "功能导航" })
      .getByRole("button")
      .count(),
    1,
  );
  assert.equal(
    await page
      .locator(".models-layout")
      .evaluate((el) => getComputedStyle(el).display),
    "grid",
  );
  assert.equal(await page.locator("details").getAttribute("open"), null);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}
try {
  await test("V1 标准与紧凑布局、分栏、折叠与固定保存区", async () => {
    await boot();
    await dirty();
    await layout("standard", 1040, 688);
    await layout("compact", 840, 544);
  });
  await test("V2 搜索、已选、列表外 ID 与全选保留缺失项", async () => {
    await boot();
    await field("搜索模型").fill("Alpha");
    assert.equal(await page.locator(".model-row").count(), 1);
    await field("搜索模型").fill("");
    await button("已选 2").click();
    assert.equal(await page.locator(".model-row").count(), 2);
    await button("已选 2").click();
    await button("全选").click();
    await button("保存配置").click();
    await poll(() =>
      !backend.calls.filter((c) => c.cmd === "save_model_config").length
        ? false
        : backend.view.config.pickerModels.includes("legacy-outside-list"),
    );
    assert.equal(backend.view.config.pickerModels.length, 36);
  });
  await test("模型名称覆盖列表与所有用途，悬停保留 ID，保存仍使用 ID", async () => {
    await boot();
    await page.locator("summary").click();
    const row = page.locator('.model-row[title="model-a"]');
    assert.equal(await row.locator(".model-name").innerText(), "Alpha");
    await row.getByRole("checkbox", { name: "将 Alpha 加入菜单" }).waitFor();
    for (const name of ["默认模型", "子代理模型", "自动审批模型", "Opus", "Sonnet", "Haiku"]) {
      const select = field(name);
      assert.equal(await select.locator('option[value="model-a"]').innerText(), "Alpha");
      assert.equal(await select.locator('option[value="model-a"]').getAttribute("title"), "model-a");
      assert.equal(await select.locator('option[value="legacy-outside-list"]').innerText(), "legacy-outside-list · 列表外");
      await select.selectOption("model-a");
      assert.equal(await select.locator("option:checked").innerText(), "Alpha");
      assert.equal(await select.getAttribute("title"), "model-a");
    }
    for (const query of ["Alpha", "model-a"]) {
      await field("搜索模型").fill(query);
      assert.equal(await page.locator(".model-row").count(), 1);
      assert.equal(await page.locator(".model-name").innerText(), "Alpha");
    }
    await button("保存配置").click();
    await poll(() => backend.calls.some((c) => c.cmd === "save_model_config"));
    for (const key of ["defaultModel", "subagentModel", "autoModeModel", "aliasOpus", "aliasSonnet", "aliasHaiku"])
      assert.equal(backend.view.config[key], "model-a");

    // Cached lists can lose a model or have no display name after a refresh.
    backend.view.models[0].displayName = null;
    backend.view.models[1].displayName = "  ";
    await button("刷新列表").click();
    await poll(async () => (await field("默认模型").locator("option:checked").innerText()) === "model-a");
    assert.equal(await page.locator('.model-row[title="model-a"] .model-name').innerText(), "model-a");
    assert.equal(await field("默认模型").locator('option[value="model-b"]').innerText(), "model-b");
    backend.view.models.shift();
    await button("刷新列表").click();
    await poll(async () => (await field("默认模型").locator("option:checked").innerText()) === "model-a · 列表外");
    await chosen("默认模型", "model-a");
  });
  await test("V2 默认、子代理、折叠别名和菜单写入", async () => {
    await boot();
    await dirty();
    await field("子代理模型").selectOption("model-a");
    await page.locator("summary").filter({ hasText: "别名映射" }).click();
    await field("Haiku").selectOption("model-b");
    await field("仅显示选中的模型").uncheck();
    await button("保存配置").click();
    await poll(() => backend.view.config.aliasHaiku === "model-b");
    assert.equal(backend.view.config.defaultModel, "model-b");
    assert.equal(backend.view.config.subagentModel, "model-a");
    assert.equal(backend.view.config.replaceBuiltIn, false);
  });
  await test("自动审批独立草稿在刷新后保留、阻止旧值覆盖并可清空", async () => {
    await boot();
    await field("自动审批模型").selectOption("model-a");
    await button("刷新列表").click();
    await chosen("自动审批模型", "model-a");
    await button("官方订阅").click();
    await button("继续编辑").click();
    await chosen("自动审批模型", "model-a");
    backend.view.config.autoModeModel = "model-b";
    backend.view.revision = "external-approval-only";
    await emit();
    await page.locator(".conflict").waitFor();
    await button("保存配置").click();
    assert.equal(backend.calls.filter((c) => c.cmd === "save_model_config").length, 0);
    await chosen("自动审批模型", "model-a");
    await button("放弃修改").click();
    await chosen("自动审批模型", "model-b");
    await field("自动审批模型").selectOption("");
    await button("保存配置").click();
    await poll(() => backend.view.config.autoModeModel === null);
  });
  await test("V3 取消连接、设置往返与刷新保留草稿", async () => {
    await boot();
    await dirty();
    await button("编辑连接").click();
    await field("地址").fill("http://changed.invalid");
    await button("取消").click();
    await chosen("默认模型", "model-b");
    await button("设置").click();
    await button("Claude Code").click();
    await chosen("默认模型", "model-b");
    await button("刷新列表").click();
    await button("刷新列表").waitFor();
    await chosen("默认模型", "model-b");
  });
  await test("V3 自有连接保存经原子基准复核后更新 revision", async () => {
    await boot();
    await dirty();
    await button("编辑连接").click();
    await field("地址").fill("http://127.0.0.1:18319");
    await button("保存连接").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await chosen("默认模型", "model-b");
    await button("保存配置").click();
    await poll(() => backend.calls.some((c) => c.cmd === "save_model_config"));
    assert.equal(
      backend.calls.find((c) => c.cmd === "save_model_config").args.revision,
      "r1c",
    );
  });
  await test("V3 无草稿跟随外部更新、无关通知不冲突", async () => {
    await boot();
    backend.view.config.defaultModel = "model-a";
    backend.view.revision = "r2";
    await emit();
    await poll(
      async () => (await field("默认模型").inputValue()) === "model-a",
    );
    await dirty();
    await emit();
    assert.equal(await page.locator(".conflict").count(), 0);
    await chosen("默认模型", "model-b");
  });
  await test("V3 外部模型更新保留草稿和旧 revision，连接保存不洗白冲突", async () => {
    await boot();
    await dirty();
    backend.view.config.defaultModel = "model-a";
    backend.view.revision = "external";
    await emit();
    await page.locator(".conflict").waitFor();
    await chosen("默认模型", "model-b");
    await button("编辑连接").click();
    await field("API Key").fill("new-key");
    await button("保存连接").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await button("保存配置").click();
    await page
      .getByRole("alert")
      .filter({ hasText: "别处更新" })
      .first()
      .waitFor();
    assert.equal(
      backend.calls.filter((c) => c.cmd === "save_model_config").length,
      0,
    );
    await chosen("默认模型", "model-b");
  });
  await test("V3 连接未编辑跟随、已编辑保留并拒绝陈旧提交", async () => {
    await boot();
    await button("编辑连接").click();
    backend.status.cpaBaseUrl = "http://127.0.0.1:18320";
    backend.status.connectionRevision = "c2";
    await emit();
    await chosen("地址", backend.status.cpaBaseUrl);
    await field("地址").fill("http://my-draft.invalid");
    backend.status.connectionRevision = "c3";
    await emit();
    await chosen("地址", "http://my-draft.invalid");
    assert(await button("保存连接").isDisabled());
    await button("重新载入连接").click();
    await chosen("地址", backend.status.cpaBaseUrl);
  });
  await test("V3 尚未通知的连接冲突也显示重新载入入口", async () => {
    await boot();
    await button("编辑连接").click();
    await field("地址").fill("http://draft.invalid");
    backend.status.cpaBaseUrl = "http://external.invalid";
    backend.status.connectionRevision = "external-connection";
    await button("保存连接").click();
    await button("重新载入连接").waitFor();
    await chosen("地址", "http://draft.invalid");
    assert(await button("保存连接").isDisabled());
    await button("重新载入连接").click();
    await chosen("地址", "http://external.invalid");
  });
  for (const command of ["refresh_models", "save_cpa"]) {
    for (const hasDraft of [false, true]) {
      await test(`V3 ${command} 期间外部通知在完成后协调${hasDraft ? "已有草稿" : "未编辑值"}`, async () => {
        await boot();
        if (hasDraft) await dirty();
        let resolve;
        backend.defer = {
          cmd: command,
          promise: new Promise((r) => (resolve = r)),
        };
        const initialReads = backend.calls.filter(
          (c) => c.cmd === "get_models",
        ).length;
        let response;
        if (command === "save_cpa") {
          await button("编辑连接").click();
          await field("API Key").fill("saved-key");
          response = {
            message: "连接已保存",
            status: clone(backend.status),
            beforeModelRevision: backend.view.revision,
            modelView: clone(backend.view),
          };
          await button("保存连接").click();
        } else await button("刷新列表").click();
        await poll(() => backend.calls.some((c) => c.cmd === command));
        backend.view.config.defaultModel = hasDraft ? "model-a" : "model-b";
        backend.view.revision = "external-during-operation";
        backend.status.cpaBaseUrl = "http://external-during-operation.invalid";
        backend.status.connectionRevision = "external-connection";
        await emit();
        resolve(command === "save_cpa" ? response : clone(backend.view));
        await poll(
          () =>
            backend.calls.filter((c) => c.cmd === "get_models").length >
            initialReads,
        );
        await poll(
          async () =>
            (await page.locator(".connection-summary code").textContent()) ===
            backend.status.cpaBaseUrl,
        );
        await chosen("默认模型", "model-b");
        if (hasDraft) {
          await page.locator(".conflict").waitFor();
          await button("保存配置").click();
          assert.equal(
            backend.calls.filter((c) => c.cmd === "save_model_config").length,
            0,
          );
          await chosen("默认模型", "model-b");
        } else assert.equal(await page.locator(".conflict").count(), 0);
      });
    }
  }
  await test("V3 补读期间再次收到通知仍会协调最新值", async () => {
    await boot();
    let finishRefresh, finishRead;
    backend.defer = {
      cmd: "refresh_models",
      promise: new Promise((r) => (finishRefresh = r)),
    };
    await button("刷新列表").click();
    backend.view.config.defaultModel = "model-a";
    backend.view.revision = "external-one";
    await emit();
    const first = clone(backend.view);
    const reads = backend.calls.filter((c) => c.cmd === "get_models").length;
    backend.defer = {
      cmd: "get_models",
      promise: new Promise((r) => (finishRead = r)),
    };
    finishRefresh(first);
    await poll(
      () => backend.calls.filter((c) => c.cmd === "get_models").length > reads,
    );
    backend.view.config.defaultModel = "model-b";
    backend.view.revision = "external-two";
    await emit();
    finishRead(first);
    await poll(
      async () => (await field("默认模型").inputValue()) === "model-b",
    );
    assert.equal(await page.locator(".conflict").count(), 0);
  });
  await test("V3 操作使通知触发的在途读取失效后仍会补读", async () => {
    await boot();
    let finishRead;
    backend.defer = {
      cmd: "get_models",
      promise: new Promise((r) => (finishRead = r)),
    };
    const old = clone(backend.view);
    backend.view.config.defaultModel = "model-b";
    backend.view.revision = "external-before-operation";
    await emit();
    const reads = backend.calls.filter((c) => c.cmd === "get_models").length;
    await button("刷新列表").click();
    await poll(
      () => backend.calls.filter((c) => c.cmd === "get_models").length > reads,
    );
    await poll(
      async () => (await field("默认模型").inputValue()) === "model-b",
    );
    finishRead(old);
    await new Promise((r) => setTimeout(r, 50));
    await chosen("默认模型", "model-b");
  });
  await test("V3 晚到读取不能覆盖新编辑或更新状态", async () => {
    await boot();
    let resolve;
    backend.defer = {
      cmd: "get_models",
      promise: new Promise((r) => (resolve = r)),
    };
    const stale = clone(backend.view);
    await emit();
    await dirty();
    backend.view.revision = "newest";
    backend.view.config.defaultModel = "model-a";
    await emit();
    resolve(stale);
    await new Promise((r) => setTimeout(r, 50));
    await chosen("默认模型", "model-b");
    await page.locator(".conflict").waitFor();
  });
  await test("V3 刷新期间继续编辑、刷新不更换草稿 revision", async () => {
    await boot();
    let resolve;
    backend.defer = {
      cmd: "refresh_models",
      promise: new Promise((r) => (resolve = r)),
    };
    await button("刷新列表").click();
    await dirty();
    const newer = clone(backend.view);
    newer.revision = "external";
    newer.config.defaultModel = "model-a";
    resolve(newer);
    await button("刷新列表").waitFor();
    await chosen("默认模型", "model-b");
    await page.locator(".conflict").waitFor();
  });
  await test("V4 模式切换继续编辑与放弃路径", async () => {
    await boot();
    await dirty();
    await button("官方订阅").click();
    await button("继续编辑").click();
    assert.equal(backend.status.mode, "cpa");
    await chosen("默认模型", "model-b");
    await button("官方订阅").click();
    await button("放弃并切换").click();
    await poll(() => backend.status.mode === "official");
  });
  await test("V4 模式切换先保存，连接保存不隐式切换", async () => {
    await boot();
    await dirty();
    await button("官方订阅").click();
    await button("保存并切换").click();
    await poll(() => backend.status.mode === "official");
    const writes = backend.calls.filter((c) =>
      ["save_model_config", "switch_mode"].includes(c.cmd),
    );
    assert.deepEqual(
      writes.map((c) => c.cmd),
      ["save_model_config", "switch_mode"],
    );
    await button("编辑连接").click();
    await field("API Key").fill("updated");
    await button("保存连接").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(backend.status.mode, "official");
  });
  await test("V4 保存失败和服务冲突阻止模式切换并保留输入", async () => {
    for (const failure of ["write", "conflict"]) {
      await boot();
      await dirty();
      if (failure === "write") backend.fail = "save_model_config";
      else backend.view.revision = "unnotified-external";
      await button("官方订阅").click();
      await button("保存并切换").click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("alert").first().waitFor();
      await chosen("默认模型", "model-b");
      assert.equal(backend.status.mode, "cpa");
      assert.equal(
        backend.calls.filter((c) => c.cmd === "switch_mode").length,
        0,
      );
    }
  });
  await test("V4 关闭边界的继续编辑、保存、放弃与失败", async () => {
    for (const action of [
      "continue",
      "save",
      "discard",
      "failure",
      "conflict",
    ]) {
      await boot();
      await dirty();
      if (action === "failure") backend.fail = "save_model_config";
      if (action === "conflict") backend.view.revision = "unnotified-change";
      await page.evaluate(() => window.__testEmit("tauri://close-requested"));
      await page.getByRole("dialog").waitFor();
      assert.equal(backend.destroyed, 0);
      if (action === "continue") {
        await button("继续编辑").click();
        await chosen("默认模型", "model-b");
      } else {
        await button(
          action === "discard" ? "放弃并关闭" : "保存并关闭",
        ).click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        await poll(() =>
          action === "failure" || action === "conflict"
            ? backend.calls.some((c) => c.cmd === "save_model_config")
            : backend.destroyed === 1,
        );
        assert.equal(
          backend.destroyed,
          action === "failure" || action === "conflict" ? 0 : 1,
        );
        if (action === "failure" || action === "conflict")
          await chosen("默认模型", "model-b");
      }
    }
  });
  await test("V4 Escape、焦点返回和 Tab 约束", async () => {
    await boot();
    await button("编辑连接").click();
    assert.equal(
      await field("地址").evaluate((el) => document.activeElement === el),
      false,
    ); // close button is first focusable
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      assert(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.contains(document.activeElement)),
      );
    }
    await field("地址").fill("http://unsaved.invalid");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert(
      await button("编辑连接").evaluate((el) => document.activeElement === el),
    );
    await dirty();
    await button("官方订阅").click();
    await page.keyboard.press("Escape");
    await chosen("默认模型", "model-b");
    assert.equal(backend.status.mode, "cpa");
  });
  await test("V5 首次配置、官方模式编辑与明确启用 CPA", async () => {
    await boot({
      status: {
        ...clone(status),
        mode: "official",
        cpaConfigured: false,
        cpaBaseUrl: null,
        cpaKeyHint: null,
      },
      view: {
        config: clone(empty),
        revision: "r1",
        source: "saved",
        models: [],
        fetchedAt: null,
      },
    });
    await button("配置 CPA").click();
    await field("地址").fill("http://127.0.0.1:18321");
    await field("API Key").fill("first-key");
    await button("保存连接").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(backend.status.mode, "official");
    backend.view.models = clone(catalog);
    await button("获取模型").first().click();
    await field("默认模型").selectOption("model-a");
    await button("保存配置").click();
    await poll(() => backend.view.config.defaultModel === "model-a");
    assert.equal(backend.status.mode, "official");
    await button("CPA").click();
    await poll(() => backend.status.mode === "cpa");
  });
  await test("V5 真实错误状态、其他连接与获取失败可见", async () => {
    await boot({
      status: {
        ...clone(status),
        mode: "error",
        error: "固定样本损坏，已停止写入",
      },
    });
    await page.getByText("固定样本损坏，已停止写入").waitFor();
    assert(await button("官方订阅").isDisabled());
    await boot({
      status: {
        ...clone(status),
        mode: "other",
        otherBaseUrl: "http://other.invalid",
      },
    });
    await page.getByText("当前使用其他连接").waitFor();
    assert(await button("官方订阅").isDisabled());
    await button("编辑连接").click();
    await field("地址").fill("http://other.invalid");
    await button("保存连接").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await boot();
    backend.fail = "refresh_models";
    await button("刷新列表").click();
    await page.getByRole("alert").first().waitFor();
    assert.equal(await page.locator(".model-row").count(), 37);
  });
  await test("V4 连接失败阻止关闭，写入期间 Escape 和重复关闭不丢草稿", async () => {
    await boot();
    await button("编辑连接").click();
    await field("API Key").fill("unsaved-key");
    backend.fail = "save_cpa";
    await page.evaluate(() => window.__testEmit("tauri://close-requested"));
    await button("保存并关闭").click();
    await page.getByRole("dialog", { name: "CPA 连接", exact: true }).waitFor();
    await chosen("API Key", "unsaved-key");
    assert.equal(backend.destroyed, 0);
    backend.fail = null;
    let resolve;
    backend.defer = {
      cmd: "save_cpa",
      promise: new Promise((r) => (resolve = r)),
    };
    await button("保存连接").click();
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__testEmit("tauri://close-requested"));
    assert.equal(await page.getByRole("dialog").count(), 1);
    assert.equal(backend.destroyed, 0);
    assert(await button("保存中…").isDisabled());
    resolve({
      message: "连接已保存",
      status: clone(backend.status),
      beforeModelRevision: backend.view.revision,
      modelView: clone(backend.view),
    });
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.evaluate(() => window.__testEmit("tauri://close-requested"));
    await poll(() => backend.destroyed === 1);
  });
  await test("V3 连接保存发现尚未通知的外部模型更新，不更换旧草稿基准", async () => {
    await boot();
    await dirty();
    backend.view.revision = "unnotified";
    backend.view.config.defaultModel = "model-a";
    await button("编辑连接").click();
    await field("API Key").fill("new-key");
    await button("保存连接").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await chosen("默认模型", "model-b");
    await page.locator(".conflict").waitFor();
    await button("保存配置").click();
    assert.equal(
      backend.calls.filter((c) => c.cmd === "save_model_config").length,
      0,
    );
  });
  await test("V5 新控件通过真实服务读取旧版固定样本并保存", async () => {
    const root = fs.mkdtempSync(path.join(out, "legacy-working-"));
    fs.cpSync("docs/verification/fixtures/legacy-cpa", root, {
      recursive: true,
    });
    const run = (...args) => {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([k]) => !/^(CLAUDE|ANTHROPIC)/i.test(k),
        ),
      );
      const r = spawnSync(
        path.resolve("src-tauri/target/debug/examples/pluckctl.exe"),
        [
          "--claude-dir",
          path.join(root, "claude"),
          "--data-dir",
          path.join(root, "data"),
          ...args,
        ],
        { encoding: "utf8", windowsHide: true, env },
      );
      if (r.error) throw r.error;
      const value = JSON.parse(r.stdout);
      if (r.status !== 0) throw new Error(value.error);
      return value;
    };
    const original = JSON.parse(
      fs.readFileSync(path.join(root, "data/state.json")),
    );
    const credentials = fs.readFileSync(
      path.join(root, "claude/.credentials.json"),
      "utf8",
    );
    try {
      await boot({
        real: (cmd, args) => {
          switch (cmd) {
            case "get_status":
              return run("status");
            case "get_models":
              return run("models");
            case "save_cpa":
              return run(
                "save-connection",
                args.baseUrl,
                args.apiKey ?? "",
                args.revision,
              );
            case "save_model_config":
              return run(
                "save-models",
                JSON.stringify(args.config),
                args.revision,
              );
            case "switch_mode":
              return run("switch", args.mode);
            default:
              throw new Error(`旧数据检查不应调用 ${cmd}`);
          }
        },
      });
      await chosen("默认模型", "legacy-outside-list");
      await chosen("子代理模型", "model-b");
      assert.equal(await page.locator(".missing").count(), 2);
      await button("编辑连接").click();
      await chosen("API Key", "");
      await page.getByText("已保存 · ****1234").waitFor();
      await page.screenshot({ path: path.join(out, "connection.png") });
      // Leave Key blank and explicitly change only the address.
      await field("地址").fill("http://127.0.0.1:18322");
      await button("保存连接").click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await field("默认模型").selectOption("model-b");
      await field("子代理模型").selectOption("model-a");
      await field("自动审批模型").selectOption("model-a");
      await page.locator("summary").click();
      await field("Haiku").selectOption("model-b");
      await button("保存配置").click();
      await poll(() => run("models").config.defaultModel === "model-b");
      await button("设置").click();
      await page.screenshot({ path: path.join(out, "settings.png") });
      const after = JSON.parse(
        fs.readFileSync(path.join(root, "data/state.json")),
      );
      const settings = JSON.parse(
        fs.readFileSync(path.join(root, "claude/settings.json")),
      );
      assert.equal(after.cpa.apiKey, original.cpa.apiKey);
      assert.deepEqual(after.snapshots, original.snapshots);
      assert.equal(settings.model, "model-b");
      assert.equal(settings.env.CLAUDE_CODE_SUBAGENT_MODEL, "model-a");
      assert.equal(settings.env.CLAUDE_CODE_AUTO_MODE_MODEL, "model-a");
      assert.equal(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "model-b");
      assert.equal(settings.env.KEEP_ME, "preserved");
      assert.equal(
        fs.readFileSync(path.join(root, "claude/.credentials.json"), "utf8"),
        credentials,
      );
      assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, original.cpa.apiKey);
      assert(run("models").config.pickerModels.includes("legacy-outside-list"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        time: new Date().toISOString(),
        browser: await browser.version(),
        productionDist: true,
        ipcBoundary: "isolated controlled IPC; no desktop automation",
        passed: results,
      },
      null,
      2,
    ),
  );
} catch (e) {
  if (page) {
    await page.screenshot({ path: path.join(out, "failure.png") });
    fs.writeFileSync(path.join(out, "failure.html"), await page.content());
  }
  throw e;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
