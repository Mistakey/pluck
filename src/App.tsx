import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errorText, type Mode, type ModelConfig, type ModelInfo, type ModelView, type Status } from "./api";

type Notice = { ok: boolean; text: string } | null;

const UNSET = "";

function same(a: ModelConfig, b: ModelConfig) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function formatTime(secs: number | null) {
  return secs ? new Date(secs * 1000).toLocaleString("zh-CN", { hour12: false }) : "尚未获取";
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  const [view, setView] = useState<ModelView | null>(null);
  const [draft, setDraft] = useState<ModelConfig | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const dirtyRef = useRef(false);

  const dirty = !!(view && draft && !same(view.config, draft));
  dirtyRef.current = dirty;

  const loadStatus = useCallback(async () => {
    const s = await api.status();
    setStatus(s);
    return s;
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const v = await api.models();
      setView(v);
      setDraft(v.config);
      setViewError(null);
      setExternalChange(false);
    } catch (e) {
      setViewError(errorText(e));
    }
  }, []);

  useEffect(() => {
    loadStatus().then((s) => setBaseUrl(s.cpaBaseUrl ?? ""));
    loadModels();
    const offs = [
      listen("status-changed", () => {
        loadStatus();
        if (dirtyRef.current) setExternalChange(true);
        else loadModels();
      }),
      listen<{ ok: boolean; message: string; source: string }>("op-result", (e) => {
        if (e.payload.source === "tray") {
          setNotice({ ok: e.payload.ok, text: `托盘：${e.payload.message}` });
        }
      }),
    ];
    return () => offs.forEach((p) => p.then((off) => off()));
  }, [loadStatus, loadModels]);

  async function run<T>(label: string, fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(label);
    try {
      const r = await fn();
      after?.(r);
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  const switchTo = (mode: Mode) =>
    run("switch", () => api.switchMode(mode), (r) => {
      setStatus(r.status);
      setNotice({ ok: true, text: r.message });
      loadModels();
    });

  const saveCpa = () =>
    run("cpa", () => api.saveCpa(baseUrl, apiKey.trim() ? apiKey : null), (r) => {
      setStatus(r.status);
      setApiKey("");
      setBaseUrl(r.status.cpaBaseUrl ?? baseUrl);
      setNotice({ ok: true, text: r.message });
      loadModels();
    });

  const refresh = () =>
    run(
      "refresh",
      async () => {
        try {
          return await api.refreshModels();
        } finally {
          loadStatus();
        }
      },
      (v) => {
        setView((old) => (old ? { ...old, models: v.models, fetchedAt: v.fetchedAt } : v));
        if (!draft) setDraft(v.config);
        setNotice({ ok: true, text: `已获取 ${v.models.length} 个模型。勾选后保存即可写入 /model 菜单。` });
      },
    );

  const saveModels = () =>
    draft &&
    view &&
    run("models", () => api.saveModelConfig(draft, view.revision), (r) => {
      setStatus(r.status);
      setNotice({ ok: true, text: r.message });
      loadModels();
    });

  const update = (patch: Partial<ModelConfig>) => draft && setDraft({ ...draft, ...patch });

  const togglePicker = (id: string, on: boolean) => {
    if (!draft) return;
    const set = new Set(draft.pickerModels);
    if (on) set.add(id);
    else set.delete(id);
    // 保持列表顺序，已配置但不在列表中的模型排在后面。
    const order = [...(view?.models.map((m) => m.id) ?? []), ...draft.pickerModels];
    update({ pickerModels: [...new Set(order)].filter((m) => set.has(m)) });
  };

  const models: ModelInfo[] = view?.models ?? [];
  const known = new Set(models.map((m) => m.id));
  const extraIds = draft
    ? [
        ...new Set(
          [draft.defaultModel, draft.subagentModel, draft.aliasOpus, draft.aliasSonnet, draft.aliasHaiku, ...draft.pickerModels].filter(
            (m): m is string => !!m && !known.has(m),
          ),
        ),
      ]
    : [];
  const options = [...models, ...extraIds.map((id) => ({ id, displayName: null, missing: true }))];

  const select = (label: string, hint: string, value: string | null, onChange: (v: string | null) => void, unsetText: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value ?? UNSET} onChange={(e) => onChange(e.target.value || null)} disabled={!draft}>
        <option value={UNSET}>{unsetText}</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id}
            {m.displayName && m.displayName !== m.id ? `（${m.displayName}）` : ""}
            {"missing" in m ? " · 不在最新列表" : ""}
          </option>
        ))}
      </select>
      <span className="hint">{hint}</span>
    </label>
  );

  const mode = status?.mode;

  return (
    <main>
      <header>
        <h1>Pluck</h1>
        <span className={`badge badge-${mode ?? "loading"}`} data-testid="mode-badge">
          {status ? status.modeLabel : "读取中"}
        </span>
      </header>

      {notice && (
        <div className={`notice ${notice.ok ? "ok" : "err"}`} role="status" data-testid="notice">
          <span>{notice.text}</span>
          <button className="link" onClick={() => setNotice(null)}>
            关闭
          </button>
        </div>
      )}

      <section className="card">
        <h2>当前用户级默认配置</h2>
        {status?.mode === "error" && <p className="err-text">{status.error}</p>}
        {status?.mode === "other" && (
          <p className="err-text">
            settings.json 中的连接（{status.otherBaseUrl ?? "仅鉴权变量"}）不是官方，也不是已保存的 CPA。Pluck 不会覆盖它；如果它就是你的
            CPA，请在下方保存该地址。
          </p>
        )}
        {status && status.mode !== "error" && (
          <dl className="status" data-testid="status">
            <dt>模式</dt>
            <dd>{status.modeLabel}</dd>
            <dt>默认模型</dt>
            <dd>{status.model ?? "未指定（原生默认）"}</dd>
            <dt>子代理默认模型</dt>
            <dd>{status.subagentModel ?? "未指定（按原生规则继承）"}</dd>
            <dt>别名映射</dt>
            <dd>
              {(["opus", "sonnet", "haiku"] as const)
                .filter((a) => status.aliases[a])
                .map((a) => `${a} → ${status.aliases[a]}`)
                .join("，") || "未指定"}
            </dd>
            <dt>/model 菜单</dt>
            <dd>{status.pickerCount ? `${status.pickerCount} 个配置项` : "内置菜单"}</dd>
          </dl>
        )}
        <div className="actions">
          <button onClick={() => switchTo("official")} disabled={!!busy || mode !== "cpa"}>
            切换到官方
          </button>
          <button
            className="primary"
            onClick={() => switchTo("cpa")}
            disabled={!!busy || mode !== "official" || !status?.cpaConfigured}
          >
            切换到 CPA
          </button>
        </div>
        <p className="hint">
          这里显示和修改的是用户级默认配置（{status?.settingsPath ?? "…"}），不代表所有正在运行的 CLI。切换后请重新打开 Claude Code
          CLI；项目级设置与 <code>--model</code> 等启动参数仍按原生规则优先。官方模式使用 Claude Code 自身登录
          {status ? (status.credentialsPresent ? "（已检测到登录凭据，Pluck 不会修改）" : "（未检测到登录凭据文件）") : ""}。
        </p>
        {status && status.processEnv.length > 0 && (
          <p className="warn-text">检测到系统环境变量 {status.processEnv.join("、")}，它们也可能影响 CLI 的实际连接或模型。</p>
        )}
      </section>

      <section className="card">
        <h2>CPA 连接</h2>
        <label className="field">
          <span className="field-label">地址</span>
          <input
            value={baseUrl}
            placeholder="http://127.0.0.1:8317"
            onChange={(e) => setBaseUrl(e.target.value)}
            data-testid="cpa-url"
          />
        </label>
        <label className="field">
          <span className="field-label">Key</span>
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder={status?.cpaKeyHint ? `已保存 ${status.cpaKeyHint}，留空沿用` : "CPA Key"}
            onChange={(e) => setApiKey(e.target.value)}
            data-testid="cpa-key"
          />
        </label>
        <div className="actions">
          <button className="primary" onClick={saveCpa} disabled={!!busy || !baseUrl.trim()}>
            {busy === "cpa" ? "保存中…" : "保存连接"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>CPA 模型</h2>
        <p className="hint">
          {view?.source === "live"
            ? "CPA 正在使用：保存会写入当前用户配置；这里显示的是文件中的实际值，包括在 CLI 中保存的修改。"
            : "CPA 未启用：保存的配置会在切换到 CPA 时应用。"}
        </p>
        <div className="actions">
          <button onClick={refresh} disabled={!!busy || !status?.cpaConfigured} data-testid="refresh">
            {busy === "refresh" ? "获取中…" : models.length ? "刷新列表" : "获取模型列表"}
          </button>
          <span className="hint">上次成功获取：{formatTime(view?.fetchedAt ?? null)}</span>
        </div>
        {viewError && <p className="err-text">{viewError}</p>}

        {draft && (
          <>
            <h3>/model 菜单</h3>
            {options.length === 0 ? (
              <p className="hint">获取列表后可选择要放入 CLI /model 菜单的模型。</p>
            ) : (
              <ul className="model-list" data-testid="model-list">
                {options.map((m) => (
                  <li key={m.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.pickerModels.includes(m.id)}
                        onChange={(e) => togglePicker(m.id, e.target.checked)}
                      />
                      <code>{m.id}</code>
                      {m.displayName && m.displayName !== m.id && <span className="muted">{m.displayName}</span>}
                      {"missing" in m && <span className="warn-text">不在最新列表</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="actions">
              <button className="link" onClick={() => update({ pickerModels: models.map((m) => m.id) })} disabled={!models.length}>
                全选列表
              </button>
              <button className="link" onClick={() => update({ pickerModels: [] })}>
                清空（使用内置菜单）
              </button>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.replaceBuiltIn}
                onChange={(e) => update({ replaceBuiltIn: e.target.checked })}
              />
              菜单只显示以上模型（隐藏内置的 Claude 系列选项）
            </label>

            <h3>默认与别名</h3>
            {select("默认模型", "新会话默认使用；在 CLI 中 /model 保存的选择也会显示在这里。", draft.defaultModel, (v) => update({ defaultModel: v }), "未指定（原生默认）")}
            {select(
              "子代理默认模型",
              "只是未另行指定模型的子代理的默认值；子代理定义或调用时指定的模型仍优先。",
              draft.subagentModel,
              (v) => update({ subagentModel: v }),
              "未指定（按原生规则继承）",
            )}
            <div className="grid3">
              {select("opus 别名", "", draft.aliasOpus, (v) => update({ aliasOpus: v }), "未指定")}
              {select("sonnet 别名", "", draft.aliasSonnet, (v) => update({ aliasSonnet: v }), "未指定")}
              {select("haiku 别名", "", draft.aliasHaiku, (v) => update({ aliasHaiku: v }), "未指定")}
            </div>
            <p className="hint">别名映射可选：让 opus / sonnet / haiku 及依赖它们的原生功能使用 CPA 的实际模型 ID。</p>

            {externalChange && (
              <p className="warn-text">配置文件已在别处被修改。保存会检测冲突；可点“放弃修改”读取最新值。</p>
            )}
            <div className="actions">
              <button className="primary" onClick={saveModels} disabled={!!busy || !dirty} data-testid="save-models">
                {busy === "models" ? "保存中…" : "保存模型配置"}
              </button>
              <button onClick={loadModels} disabled={!!busy}>
                放弃修改
              </button>
            </div>
          </>
        )}
      </section>

      <footer className="hint">
        Claude 配置目录：{status?.configDir} · Pluck 数据：{status?.dataPath}
      </footer>
    </main>
  );
}
