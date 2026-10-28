import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  api,
  errorText,
  type ModelConfig,
  type ModelView,
  type Status,
  type Mode,
} from "./api";

export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
type Connection = { url: string; key: string; revision: string };
type Action = Mode | "close";
type State = {
  status: Status | null;
  view: ModelView | null;
  draft: ModelConfig | null;
  connection: Connection | null;
  editing: boolean;
  conflict: boolean;
  busy: string | null;
  confirm: Action | null;
  notice: { text: string; error: boolean } | null;
  viewError: string | null;
};
const connectionFrom = (s: Status): Connection => ({
  url: s.cpaBaseUrl ?? "",
  key: "",
  revision: s.connectionRevision,
});
export const modelDirty = (s: State) =>
  !!(s.view && s.draft && !same(s.view.config, s.draft));
const connectionDirty = (s: State) =>
  !!(
    s.connection &&
    s.status &&
    (s.connection.url !== (s.status.cpaBaseUrl ?? "") ||
      s.connection.key ||
      s.connection.revision !== s.status.connectionRevision)
  );

export function useWorkspace() {
  const initial: State = {
    status: null,
    view: null,
    draft: null,
    connection: null,
    editing: false,
    conflict: false,
    busy: null,
    confirm: null,
    notice: null,
    viewError: null,
  };
  const [state, render] = useState(initial);
  const ref = useRef(state);
  const epoch = useRef(0);
  const changes = useRef(0);
  const reconciledChanges = useRef(0);
  const alive = useRef(true);
  function patch(p: Partial<State>) {
    ref.current = { ...ref.current, ...p };
    if (alive.current) render(ref.current);
  }
  function error(e: unknown) {
    patch({ notice: { text: errorText(e), error: true } });
  }
  function acceptStatus(status: Status) {
    const s = ref.current;
    const c = s.connection;
    // Unedited form follows state; an edited form keeps its original connection revision.
    const untouched =
      !c ||
      (!!s.status &&
        c.url === (s.status.cpaBaseUrl ?? "") &&
        !c.key &&
        c.revision === s.status.connectionRevision);
    patch({
      status,
      ...(untouched ? { connection: connectionFrom(status) } : {}),
    });
  }
  function acceptView(view: ModelView, discard = false) {
    const s = ref.current;
    if (!discard && modelDirty(s)) {
      const changed =
        s.view!.revision !== view.revision || s.view!.source !== view.source;
      patch({
        view: { ...s.view!, models: view.models, fetchedAt: view.fetchedAt },
        conflict: s.conflict || changed,
        viewError: null,
      });
    } else
      patch({ view, draft: view.config, conflict: false, viewError: null });
  }
  async function sync(discard = false) {
    const token = ++epoch.current;
    const observedChanges = changes.current;
    const [status, view] = await Promise.allSettled([
      api.status(),
      api.models(),
    ]);
    if (token !== epoch.current || !alive.current) return;
    if (status.status === "fulfilled") acceptStatus(status.value);
    else error(status.reason);
    if (view.status === "fulfilled") acceptView(view.value, discard);
    else patch({ viewError: errorText(view.reason) });
    // Only an accepted read consumes notifications. A write can invalidate an
    // idle read; notifications arriving during this read require another pass.
    reconciledChanges.current = observedChanges;
  }
  async function operation(label: string, fn: () => Promise<void>) {
    if (ref.current.busy) return false;
    ++epoch.current;
    patch({ busy: label, notice: null });
    try {
      await fn();
      return true;
    } catch (e) {
      error(e);
      // A rejected write may be the first sign of an external edit (before the
      // watcher fires). Reconcile now so its recovery controls are available.
      await sync();
      return false;
    } finally {
      while (alive.current && reconciledChanges.current < changes.current) {
        await sync();
      }
      patch({ busy: null });
    }
  }
  async function saveConnection() {
    const s = ref.current,
      c = s.connection;
    if (!c || !s.status) throw new Error("连接尚未读取，请重试。");
    if (c.revision !== s.status.connectionRevision)
      throw new Error(
        "CPA 连接已在别处更新。输入已保留，请重新载入连接后再保存。",
      );
    const r = await api.saveCpa(c.url, c.key.trim() ? c.key : null, c.revision);
    const current = ref.current;
    // The service captured both revisions inside the same lock. Rebase only our own
    // connection write, with an identical model baseline; never bless external edits.
    if (
      modelDirty(current) &&
      current.view?.revision === r.beforeModelRevision &&
      current.view.source === r.modelView.source &&
      same(current.view.config, r.modelView.config) &&
      !current.conflict
    ) {
      patch({ view: r.modelView });
    } else acceptView(r.modelView);
    patch({
      status: r.status,
      connection: connectionFrom(r.status),
      editing: false,
      notice: { text: r.message, error: false },
    });
  }
  async function saveModels() {
    const { view, draft, conflict } = ref.current;
    if (!view || !draft) throw new Error("模型配置尚未读取，请重试。");
    if (conflict)
      throw new Error(
        "配置已在别处更新，修改已保留。请放弃修改、读取最新配置后再编辑。",
      );
    const r = await api.saveModelConfig(draft, view.revision);
    // Inputs are disabled during writes. Mark exactly the submitted draft saved,
    // then reconcile a fresh read (including external writes after this operation).
    patch({
      status: r.status,
      view: { ...view, config: draft },
      notice: { text: r.message, error: false },
    });
    await sync();
    if (ref.current.viewError)
      throw new Error(`保存已完成，但重新读取失败：${ref.current.viewError}`);
  }
  async function perform(action: Action) {
    if (action === "close") {
      await getCurrentWindow().destroy();
      return;
    }
    const r = await api.switchMode(action);
    patch({
      status: r.status,
      notice: { text: r.message, error: false },
      editing: false,
    });
    await sync(true);
  }
  function request(action: Action) {
    const s = ref.current;
    if (s.busy) return;
    if (action !== "close" && s.status?.mode === action) return;
    if (action === "cpa" && !s.status?.cpaConfigured) {
      patch({ editing: true });
      return;
    }
    if (modelDirty(s) || connectionDirty(s)) patch({ confirm: action });
    else void operation("switch", () => perform(action));
  }
  async function finish(save: boolean) {
    const action = ref.current.confirm;
    if (!action) return;
    const ok = await operation("continue", async () => {
      if (save) {
        if (connectionDirty(ref.current)) await saveConnection();
        if (modelDirty(ref.current)) await saveModels();
      } else {
        // Reload can fail; keep the context and refuse the destructive action.
        await sync(true);
        if (ref.current.viewError) throw new Error(ref.current.viewError);
        if (ref.current.status)
          patch({ connection: connectionFrom(ref.current.status) });
      }
      await perform(action);
    });
    // On failure reveal the original form and its durable error.
    patch({ confirm: null, ...(ok ? { editing: false } : {}) });
  }
  useEffect(() => {
    alive.current = true;
    void sync();
    const offs = [
      listen("status-changed", () => {
        ++changes.current;
        if (!ref.current.busy) void sync();
      }),
      listen<{ ok: boolean; message: string; source: string }>(
        "op-result",
        (e) => {
          if (e.payload.source === "tray")
            patch({
              notice: {
                text: `托盘：${e.payload.message}`,
                error: !e.payload.ok,
              },
            });
        },
      ),
      getCurrentWindow().onCloseRequested((e) => {
        if (
          ref.current.busy ||
          modelDirty(ref.current) ||
          connectionDirty(ref.current)
        ) {
          e.preventDefault();
          if (!ref.current.busy) patch({ confirm: "close" });
        }
      }),
    ];
    return () => {
      alive.current = false;
      ++epoch.current;
      offs.forEach((p) => p.then((off) => off()).catch(() => {}));
    };
  }, []);
  return {
    ...state,
    dirtyModels: modelDirty(state),
    dirtyConnection: connectionDirty(state),
    patch,
    request,
    finish,
    sync,
    update: (p: Partial<ModelConfig>) =>
      ref.current.draft && patch({ draft: { ...ref.current.draft, ...p } }),
    editConnection: () => patch({ editing: true, notice: null }),
    cancelConnection: () =>
      patch({
        editing: false,
        connection: ref.current.status
          ? connectionFrom(ref.current.status)
          : null,
        notice: null,
      }),
    reloadConnection: () =>
      ref.current.status &&
      patch({ connection: connectionFrom(ref.current.status), notice: null }),
    saveConnection: () => operation("connection", saveConnection),
    saveModels: () => operation("models", saveModels),
    reloadModels: () => operation("reload", () => sync(true)),
    refresh: () =>
      operation("refresh", async () => {
        const token = epoch.current;
        const v = await api.refreshModels();
        if (token !== epoch.current) return;
        // Refresh is a catalog operation, never a new editing baseline.
        const current = ref.current;
        if (current.view)
          patch({
            view: { ...current.view, models: v.models, fetchedAt: v.fetchedAt },
            conflict:
              current.conflict ||
              (modelDirty(current) &&
                (current.view.revision !== v.revision ||
                  current.view.source !== v.source)),
          });
        else acceptView(v);
        patch({
          notice: { text: `已获取 ${v.models.length} 个模型。`, error: false },
        });
      }),
  };
}
