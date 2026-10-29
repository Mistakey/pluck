import type { UpdateStatus } from "./api";

export function UpdatePanel({ status, busy, check, install, compact = false }: {
  status: UpdateStatus | null;
  busy: boolean;
  check: () => void;
  install: () => void;
  compact?: boolean;
}) {
  const active = status && ["checking", "downloading", "installing"].includes(status.phase);
  const downloading = status?.phase === "downloading";
  return (
    <section className="update-panel" aria-label="应用更新">
      <h2>{status?.version ? `发现新版 ${status.version}` : "应用更新"}</h2>
      <p>当前版本 {status?.currentVersion ?? "读取中…"}</p>
      {status?.notes && <pre className="release-notes">{status.notes}</pre>}
      {status?.phase === "current" && <p role="status">已是最新版本。</p>}
      {status?.phase === "checking" && <p role="status">正在检查更新…</p>}
      {status?.phase === "installing" && <p role="status">正在安装，完成后将重新启动…</p>}
      {downloading && <div className="update-progress" role="status">
        <progress aria-label="更新下载进度" max={status.total ?? undefined} value={status.total ? status.downloaded : undefined} />
        <p>{status.total ? `${Math.min(100, Math.round(status.downloaded / status.total * 100))}% · ` : ""}
          {(status.downloaded / 1024 / 1024).toFixed(1)} MiB 已下载</p>
      </div>}
      {status?.error && <p className="update-error" role="alert">{status.error}</p>}
      {status?.installBlocked && <p>{status.installBlocked}</p>}
      <div className="update-actions">
        {(!compact || status?.retry === "check") && <button className="button" disabled={busy || !!active || !status} onClick={check}>
          {status?.retry === "check" ? "重试检查" : "检查更新"}
        </button>}
        {status?.version && <button className={`button ${compact ? "" : "primary"}`}
          disabled={busy || !!active || !!status.installBlocked} onClick={install}>
          {status.retry === "install" ? "重试更新并重启" : "更新并重启"}
        </button>}
      </div>
    </section>
  );
}
