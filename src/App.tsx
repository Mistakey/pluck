import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWorkspace } from "./useWorkspace";
import type { ModelConfig, ModelInfo } from "./api";
import { UpdatePanel } from "./UpdatePanel";

function modelName(model: ModelInfo): string {
  return model.displayName?.trim() || model.id;
}

function Icon({
  name,
}: {
  name: "tool" | "settings" | "search" | "refresh" | "arrow" | "plug";
}) {
  const paths = {
    tool: "m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16",
    settings:
      "m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3ZM9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
    search: "M16 16l5 5M17 10a7 7 0 1 0-14 0 7 7 0 0 0 14 0",
    refresh: "M20 8a8 8 0 1 0 0 8M20 3v5h-5",
    arrow: "m9 5 7 7-7 7",
    plug: "M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-6 6v4m0-4a6 6 0 0 1-6-6",
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
function Dialog({
  title,
  children,
  busy,
  onCancel,
  initialFocus,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  onCancel: () => void;
  initialFocus?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const latest = useRef({ busy, onCancel });
  latest.current = { busy, onCancel };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = dialog.current!;
    const items = () => [
      ...root.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
      ),
    ];
    const preferred = initialFocus
      ? root.querySelector<HTMLElement>(initialFocus)
      : null;
    (preferred ?? items()[0] ?? root).focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!latest.current.busy) latest.current.onCancel();
      }
      if (e.key === "Tab") {
        const all = items();
        if (!all.length) {
          e.preventDefault();
          root.focus();
        } else if (
          e.shiftKey &&
          (document.activeElement === all[0] ||
            !root.contains(document.activeElement))
        ) {
          e.preventDefault();
          all.at(-1)!.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === all.at(-1) ||
            !root.contains(document.activeElement))
        ) {
          e.preventDefault();
          all[0].focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const w = useWorkspace();
  const [page, setPage] = useState<"claude" | "settings">("claude");
  const [search, setSearch] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const { status, view, draft } = w;
  const canSave = w.dirtyModels && !w.busy && !w.viewError;
  const shortcuts = useRef({ page, canSave, w });
  shortcuts.current = { page, canSave, w };
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const { page, canSave, w } = shortcuts.current;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (w.editing || w.confirm || page !== "claude") return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        if (canSave) void w.saveModels();
      } else if (k === "f" && searchInput.current) {
        e.preventDefault();
        searchInput.current.focus();
        searchInput.current.select();
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  function openPage(next: "claude" | "settings") {
    if (next !== page && w.notice && !w.notice.error) w.patch({ notice: null });
    setPage(next);
  }
  const writing = !!w.busy && w.busy !== "refresh";
  const models = view?.models ?? [];
  const known = new Set(models.map((m) => m.id));
  const missing = draft
    ? [
        ...new Set(
          [
            draft.defaultModel,
            draft.subagentModel,
            draft.autoModeModel,
            draft.aliasOpus,
            draft.aliasSonnet,
            draft.aliasHaiku,
            ...draft.pickerModels,
          ].filter((id): id is string => !!id && !known.has(id)),
        ),
      ]
    : [];
  const options = [
    ...models.map((m) => ({ ...m, missing: false })),
    ...missing.map((id) => ({ id, displayName: null, missing: true })),
  ];
  const selected = new Set(draft?.pickerModels);
  const visible = options.filter(
    (m) =>
      (!onlySelected || selected.has(m.id)) &&
      `${m.id} ${m.displayName ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  // While searching, bulk actions apply to the matching rows only.
  const searching = !!search.trim();
  const visibleIds = visible.map((m) => m.id);
  const fetchedLabel = view?.fetchedAt
    ? `${models.length} 个 · ${new Date(view.fetchedAt * 1000).toLocaleString(
        "zh-CN",
        { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" },
      )} 获取`
    : "尚未获取";
  function select(
    label: string,
    key:
      | "defaultModel"
      | "subagentModel"
      | "autoModeModel"
      | "aliasOpus"
      | "aliasSonnet"
      | "aliasHaiku",
  ) {
    return (
      <label className="field">
        <span>{label}</span>
        <select
          aria-label={label}
          title={draft?.[key] ?? undefined}
          disabled={writing || !draft}
          value={draft?.[key] ?? ""}
          onChange={(e) =>
            w.update({ [key]: e.target.value || null } as Partial<ModelConfig>)
          }
        >
          <option value="">
            {key === "defaultModel"
              ? "使用原生默认"
              : key === "subagentModel"
                ? "跟随主模型"
                : key === "autoModeModel"
                  ? "使用原生审批默认"
                  : "不指定"}
          </option>
          {options.map((m) => (
            <option key={m.id} value={m.id} title={m.id}>
              {modelName(m)}
              {m.missing ? " · 列表外" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const alert = w.notice && (
    <div
      className={`notice ${w.notice.error ? "error" : ""}`}
      role={w.notice.error ? "alert" : "status"}
    >
      <span>{w.notice.text}</span>
      <button aria-label="关闭提示" onClick={() => w.patch({ notice: null })}>
        ×
      </button>
    </div>
  );
  const refreshButton = (
    <button
      className="button"
      disabled={!!w.busy || !status?.cpaConfigured}
      onClick={w.refresh}
    >
      <Icon name="refresh" />
      {w.busy === "refresh"
        ? "获取中…"
        : models.length
          ? "刷新列表"
          : "获取模型"}
    </button>
  );
  const connectionConflict = !!(
    w.connection &&
    status &&
    w.connection.revision !== status.connectionRevision
  );
  const cancelConnection = () => {
    w.cancelConnection();
    setShowKey(false);
  };
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">P</span>Pluck
        </div>
        <nav aria-label="功能导航">
          <button
            aria-current={page === "claude" ? "page" : undefined}
            onClick={() => openPage("claude")}
          >
            <Icon name="tool" />
            Claude Code
            {(w.dirtyModels || w.dirtyConnection) && (
              <span className="dirty-dot" role="img" aria-label="未保存修改" />
            )}
          </button>
        </nav>
        <button
          className="settings-nav"
          aria-current={page === "settings" ? "page" : undefined}
          onClick={() => openPage("settings")}
        >
          <Icon name="settings" />
          设置
          {w.updates?.version && <span className="dirty-dot update" role="img" aria-label="发现新版本" />}
        </button>
      </aside>
      <main className="workspace" inert={w.editing || !!w.confirm}>
        <header className="workspace-heading">
          <div className="heading-row">
            <h1>{page === "settings" ? "设置" : "Claude Code"}</h1>
            {page === "claude" && (
              <div className="mode-switch">
                <small role="status">
                  {w.busy === "switch" ? "切换中…" : ""}
                </small>
                <div
                  className="segmented"
                  role="group"
                  aria-label="Claude Code 使用方式"
                >
                  {(["official", "cpa"] as const).map((m) => (
                    <button
                      key={m}
                      aria-pressed={status?.mode === m}
                      disabled={
                        !!w.busy ||
                        !status ||
                        status.mode === "error" ||
                        status.mode === "other"
                      }
                      onClick={() => w.request(m)}
                    >
                      {status?.mode === m && <span className="status-dot" />}
                      {m === "official"
                        ? "官方订阅"
                        : status?.cpaConfigured
                          ? "CPA"
                          : "配置 CPA"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {page === "claude" && (
            <div className="connection-line">
              <span>CPA</span>
              <code title={status?.cpaBaseUrl ?? ""}>
                {status?.cpaBaseUrl ?? "尚未配置连接"}
              </code>
              {status?.mode === "official" && status.cpaConfigured && (
                <span className="neutral-badge">未启用</span>
              )}
              <button
                className="link-button"
                disabled={!!w.busy || !status || status.mode === "error"}
                onClick={() => {
                  w.editConnection();
                  setShowKey(false);
                }}
              >
                {status?.cpaConfigured ? "编辑连接" : "配置连接"}
              </button>
            </div>
          )}
          {page === "claude" && !!status?.processEnv.length && (
            <p className="env-warning">
              检测到系统环境变量 {status.processEnv.join("、")}
              ，可能改变 CLI 实际使用的连接或模型。
            </p>
          )}
        </header>
        <div className="feedback">{alert}</div>
        {page === "settings" ? (
          <div className="settings-content">
            <UpdatePanel status={w.updates} busy={!!w.busy} check={() => void w.checkUpdates()} install={() => w.request("update")} />
            <section>
              <h2>配置位置</h2>
              {[
                ["Claude Code 用户配置", status?.settingsPath],
                ["Pluck 数据", status?.dataPath],
                ["Claude 配置目录", status?.configDir],
              ].map(([label, path]) => (
                <div className="settings-row" key={label}>
                  <div>
                    <strong>{label}</strong>
                    <code>{path ?? "读取中…"}</code>
                  </div>
                </div>
              ))}
            </section>
            <section>
              <h2>关于</h2>
              <p>Pluck · Claude Code 配置管理 · {w.updates?.currentVersion ?? "读取中…"}</p>
              <p>
                官方模式使用 Claude Code 自身登录
                {status?.credentialsPresent
                  ? "（已检测到凭据）"
                  : "（未检测到凭据）"}
                ，Pluck 不修改登录凭据。
              </p>
              <p>
                这里只修改用户级默认值。请重新打开 Claude Code CLI
                以完整生效；项目设置、启动参数与环境变量仍按原生规则优先。
              </p>
              {!!status?.processEnv.length && (
                <p className="warning">
                  检测到环境变量：{status.processEnv.join("、")}
                </p>
              )}
            </section>
          </div>
        ) : (
          <>
            {status?.mode === "error" && (
              <div className="state-error" role="alert">
                <strong>配置无法读取</strong>
                <p>{status.error}</p>
                <button
                  className="button"
                  disabled={!!w.busy}
                  onClick={() => void w.sync()}
                >
                  重新读取
                </button>
              </div>
            )}
            {status?.mode === "other" && (
              <div className="state-error" role="alert">
                <strong>当前使用其他连接</strong>
                <p>
                  {status.otherBaseUrl ?? "仅鉴权变量"}。Pluck
                  不会自动覆盖。如需将它作为 CPA，请明确保存该连接。
                </p>
              </div>
            )}
            {w.conflict && (
              <div className="conflict" role="alert">
                <span>配置已在别处更新，你的编辑仍然保留。</span>
                <button disabled={!!w.busy} onClick={w.reloadModels}>
                  放弃并重新载入
                </button>
              </div>
            )}
            {w.viewError && (
              <div className="state-error" role="alert">
                <p>{w.viewError}</p>
                <button disabled={!!w.busy} onClick={() => void w.sync()}>
                  重新读取模型配置
                </button>
              </div>
            )}
            {!status?.cpaConfigured && status?.mode !== "error" ? (
              <div className="official-state">
                <Icon name="plug" />
                <div>
                  <h2>连接你的 CPA</h2>
                  <p>
                    官方订阅继续使用 Claude Code 自身的登录和模型。配置 CPA
                    后，可在这里选择模型并明确启用。
                  </p>
                  <button
                    className="button primary"
                    disabled={!status || !!w.busy}
                    onClick={w.editConnection}
                  >
                    配置连接
                  </button>
                </div>
              </div>
            ) : (
              <div className="models-layout">
                <section className="catalog">
                  <div className="section-heading">
                    <h2>模型菜单</h2>
                    <span
                      className="fetched"
                      title={
                        view?.fetchedAt
                          ? new Date(view.fetchedAt * 1000).toLocaleString()
                          : undefined
                      }
                    >
                      {fetchedLabel}
                    </span>
                    {refreshButton}
                  </div>
                  <div className="list-tools">
                    <div className="search-field">
                      <Icon name="search" />
                      <input
                        ref={searchInput}
                        aria-label="搜索模型"
                        aria-keyshortcuts="Control+F"
                        placeholder="搜索模型名称或 ID"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape" && search) {
                            e.preventDefault();
                            setSearch("");
                          }
                        }}
                      />
                    </div>
                    <button
                      className={`filter-button ${onlySelected ? "active" : ""}`}
                      aria-pressed={onlySelected}
                      onClick={() => setOnlySelected(!onlySelected)}
                    >
                      已选 {selected.size}
                    </button>
                  </div>
                  <div className="model-rows" data-testid="model-list">
                    {visible.length ? (
                      visible.map((m, i) => {
                        const name = modelName(m);
                        const tag = m.missing
                          ? "列表外"
                          : draft?.defaultModel === m.id
                            ? "默认"
                            : draft?.subagentModel === m.id
                              ? "子代理"
                              : null;
                        const describedBy =
                          [
                            name !== m.id && `model-id-${i}`,
                            tag && `model-tag-${i}`,
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined;
                        return (
                          <label className="model-row" key={m.id} title={m.id}>
                            <input
                              type="checkbox"
                              aria-label={`将 ${name} 加入菜单`}
                              aria-describedby={describedBy}
                              checked={selected.has(m.id)}
                              disabled={writing || !draft}
                              onChange={(e) =>
                                w.update({
                                  pickerModels: e.target.checked
                                    ? [...selected, m.id]
                                    : [...selected].filter((id) => id !== m.id),
                                })
                              }
                            />
                            <div className="model-name">
                              <span>{name}</span>
                            </div>
                            {name !== m.id && (
                              <code className="model-id" id={`model-id-${i}`}>
                                {m.id}
                              </code>
                            )}
                            {tag && (
                              <span
                                className={m.missing ? "missing" : "model-tag"}
                                id={`model-tag-${i}`}
                              >
                                {tag}
                              </span>
                            )}
                          </label>
                        );
                      })
                    ) : (
                      <div className="empty">
                        <Icon name={search ? "search" : "plug"} />
                        <strong>
                          {search
                            ? "没有匹配的模型"
                            : onlySelected
                              ? "尚未选择模型"
                              : "还没有模型列表"}
                        </strong>
                        <p>
                          {search
                            ? "试试其他名称或 ID。"
                            : onlySelected
                              ? "切回全部模型后选择。"
                              : "获取 CPA 模型列表后即可选择。"}
                        </p>
                        {!search && !onlySelected && refreshButton}
                      </div>
                    )}
                  </div>
                  <div className="selection-tools">
                    {searching ? (
                      <>
                        <button
                          disabled={
                            writing ||
                            !draft ||
                            visibleIds.every((id) => selected.has(id))
                          }
                          onClick={() =>
                            w.update({
                              pickerModels: [
                                ...new Set([...selected, ...visibleIds]),
                              ],
                            })
                          }
                        >
                          选中 {visible.length} 个结果
                        </button>
                        <button
                          disabled={
                            writing ||
                            !draft ||
                            !visibleIds.some((id) => selected.has(id))
                          }
                          onClick={() =>
                            w.update({
                              pickerModels: [...selected].filter(
                                (id) => !visibleIds.includes(id),
                              ),
                            })
                          }
                        >
                          取消选中结果
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          disabled={writing || !draft || !models.length}
                          onClick={() =>
                            w.update({
                              pickerModels: [
                                ...new Set([
                                  ...models.map((m) => m.id),
                                  ...missing.filter((id) => selected.has(id)),
                                ]),
                              ],
                            })
                          }
                        >
                          全选
                        </button>
                        <button
                          disabled={writing || !draft || !selected.size}
                          onClick={() => w.update({ pickerModels: [] })}
                        >
                          清空
                        </button>
                      </>
                    )}
                    <label className="policy">
                      <input
                        type="checkbox"
                        checked={draft?.replaceBuiltIn ?? false}
                        disabled={writing || !draft}
                        onChange={(e) =>
                          w.update({ replaceBuiltIn: e.target.checked })
                        }
                      />
                      在 /model 中隐藏内置模型
                    </label>
                  </div>
                </section>
                <aside className="defaults-panel">
                  <h2>模型用途</h2>
                  {select("默认模型", "defaultModel")}
                  {select("子代理模型", "subagentModel")}
                  {select("自动审批模型", "autoModeModel")}
                  <p className="approval-hint">
                    自动审批需 Claude Code 2.1.302+；服务端策略可能覆盖此选择，以
                    CLI 调试日志为准。
                  </p>
                  <details className="alias-disclosure">
                    <summary>
                      别名映射<span>可选</span>
                      <Icon name="arrow" />
                    </summary>
                    <p>为原生模型别名指定 CPA 模型。</p>
                    {select("Opus", "aliasOpus")}
                    {select("Sonnet", "aliasSonnet")}
                    {select("Haiku", "aliasHaiku")}
                  </details>
                </aside>
              </div>
            )}
            <footer
              className={`editor-footer ${w.dirtyModels ? "has-edits" : ""}`}
            >
              <div role="status">
                {w.dirtyModels && (
                  <>
                    <span className="dirty-dot" />
                    有未保存修改
                  </>
                )}
              </div>
              <div className="footer-actions">
                <button
                  className="button quiet"
                  aria-disabled={!w.dirtyModels || !!w.busy}
                  onClick={() => {
                    if (w.dirtyModels && !w.busy) w.reloadModels();
                  }}
                >
                  放弃修改
                </button>
                <button
                  className="button primary"
                  aria-disabled={!canSave}
                  aria-keyshortcuts="Control+S"
                  title="Ctrl+S"
                  onClick={() => {
                    if (canSave) void w.saveModels();
                  }}
                >
                  {w.busy === "models" ? "保存中…" : "保存配置"}
                </button>
              </div>
            </footer>
          </>
        )}
      </main>
      {w.editing && !w.confirm && (
        <Dialog
          title="CPA 连接"
          busy={!!w.busy}
          onCancel={cancelConnection}
          initialFocus='input[name="url"]:not(:disabled)'
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void w.saveConnection();
            }}
          >
            <div className="dialog-heading">
              <h2>CPA 连接</h2>
              <button
                type="button"
                aria-label="关闭连接设置"
                disabled={!!w.busy}
                onClick={cancelConnection}
              >
                ×
              </button>
            </div>
            {alert}
            {w.updates?.version && <UpdatePanel compact status={w.updates} busy={!!w.busy} check={() => void w.checkUpdates()} install={() => w.request("update")} />}
            {connectionConflict && (
              <div className="conflict" role="alert">
                <span>连接已在别处更新，输入已保留。</span>
                <button type="button" onClick={w.reloadConnection}>
                  重新载入连接
                </button>
              </div>
            )}
            <fieldset disabled={!!w.busy} className="connection-fields">
              <label className="field">
                <span>地址</span>
                <input
                  name="url"
                  autoComplete="off"
                  value={w.connection?.url ?? ""}
                  placeholder="http://127.0.0.1:8317"
                  onChange={(e) =>
                    w.connection &&
                    w.patch({
                      connection: { ...w.connection, url: e.target.value },
                    })
                  }
                />
              </label>
              <label className="field">
                <span>
                  API Key
                  {status?.cpaKeyHint && (
                    <small className="key-saved">
                      已保存 · {status.cpaKeyHint}
                    </small>
                  )}
                </span>
                <div className="password-field">
                  <input
                    aria-label="API Key"
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    value={w.connection?.key ?? ""}
                    placeholder={
                      status?.cpaConfigured
                        ? "留空沿用已保存的 Key"
                        : "填写 CPA Key"
                    }
                    onChange={(e) =>
                      w.connection &&
                      w.patch({
                        connection: { ...w.connection, key: e.target.value },
                      })
                    }
                  />
                  <button type="button" onClick={() => setShowKey(!showKey)}>
                    {showKey ? "隐藏" : "显示"}
                  </button>
                </div>
              </label>
            </fieldset>
            <div className="modal-actions">
              <button
                className="button quiet"
                type="button"
                disabled={!!w.busy}
                onClick={cancelConnection}
              >
                取消
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={
                  !!w.busy ||
                  connectionConflict ||
                  !w.connection?.url.trim() ||
                  !w.dirtyConnection
                }
              >
                {w.busy === "connection" ? "保存中…" : "保存连接"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {w.confirm && (
        <Dialog
          title="有未保存的修改"
          busy={!!w.busy}
          onCancel={() => w.patch({ confirm: null })}
        >
          <h2>有未保存的修改</h2>
          <p>
            {w.confirm === "close"
              ? "关闭前是否保存本次修改？"
              : w.confirm === "update"
                ? "下载更新前，先处理模型与连接的修改。取消将继续编辑。"
              : "切换前，先处理本次修改。"}
          </p>
          <div className="modal-actions">
            <button
              className="button quiet"
              disabled={!!w.busy}
              onClick={() => w.patch({ confirm: null })}
            >
              继续编辑
            </button>
            <button
              className="button"
              disabled={!!w.busy}
              onClick={() => void w.finish(false)}
            >
              {w.confirm === "close" ? "放弃并关闭" : w.confirm === "update" ? "放弃并更新" : "放弃并切换"}
            </button>
            <button
              className="button primary"
              disabled={!!w.busy}
              onClick={() => void w.finish(true)}
            >
              {w.busy
                ? "保存中…"
                : w.confirm === "close"
                  ? "保存并关闭"
                  : w.confirm === "update"
                    ? "保存并更新"
                  : "保存并切换"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
