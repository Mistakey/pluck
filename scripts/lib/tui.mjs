// 在伪终端中运行交互式 CLI，并用无头终端还原屏幕文本，便于脚本断言。
import pty from "@lydell/node-pty";
import xtermHeadless from "@xterm/headless";

const { Terminal } = xtermHeadless;

export function startTui(file, args, { cwd, env, cols = 140, rows = 45 }) {
  const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 2000 });
  const proc = pty.spawn(file, args, { name: "xterm-256color", cols, rows, cwd, env });
  let exited = null;
  proc.onData((d) => term.write(d));
  proc.onExit((e) => (exited = e));

  const screen = () => {
    const buf = term.buffer.active;
    const lines = [];
    for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
    return lines.slice(Math.max(0, buf.baseY)).join("\n").replace(/\n+$/, "");
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(pattern, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const s = screen();
      if (pattern.test(s)) return s;
      if (exited) throw new Error(`进程已退出（${exited.exitCode}）\n${s}`);
      await sleep(200);
    }
    throw new Error(`等待 ${pattern} 超时\n----- 屏幕 -----\n${screen()}`);
  }

  async function type(text, delay = 30) {
    for (const ch of text) {
      proc.write(ch);
      await sleep(delay);
    }
  }

  return {
    proc,
    screen,
    waitFor,
    type,
    sleep,
    write: (s) => proc.write(s),
    exited: () => exited,
    kill: () => {
      try {
        proc.kill();
      } catch {}
    },
  };
}

export const KEY = { enter: "\r", esc: "\x1b", up: "\x1b[A", down: "\x1b[B", ctrlC: "\x03" };
