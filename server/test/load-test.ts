import { spawn } from "node:child_process";
import path from "node:path";
import { asSeq, encodeInputBinary } from "@jstanks/shared";
import WebSocket from "ws";

const PORT = 3799;
const BASE = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}/ws`;

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Server not ready");
}

function spawnBot(
  idx: number,
): Promise<{ close: () => void; bytes: () => number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    ws.binaryType = "arraybuffer";
    let seq = 1;
    let rx = 0;
    let t: ReturnType<typeof setInterval> | null = null;

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "join",
          room: "training-range",
          name: `Bot_${idx}`,
          codec: "binary",
        }),
      );
      t = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            encodeInputBinary({
              seq: asSeq(seq++),
              thrust: 1,
              turn: idx % 2 === 0 ? 1 : -1,
              fire: seq % 15 === 0,
              missile: false,
              clientTick: seq,
            }),
          );
        }
      }, 33);
      resolve({
        close: () => {
          if (t) clearInterval(t);
          ws.close();
        },
        bytes: () => rx,
      });
    });

    ws.on("message", (d: ArrayBuffer | Buffer) => {
      rx += d.byteLength;
    });
    ws.on("error", reject);
  });
}

async function main() {
  const entry = path.resolve(import.meta.dirname, "../src/index.ts");
  const child = spawn(process.execPath, ["--import", "tsx", entry], {
    env: { ...process.env, PORT: String(PORT), MAX_PLAYERS_PER_ROOM: "200" },
    stdio: "ignore",
  });

  try {
    await waitReady();
    console.log(
      "\n| Clients | Tick p99 (ms) | ELU (%) | RSS (MB) | Rx (KB/s) | Budget (<33.3ms) |",
    );
    console.log(
      "|--------:|--------------:|--------:|---------:|----------:|:----------------:|",
    );

    for (const n of [8, 32, 64, 128]) {
      const list = [];
      for (let i = 0; i < n; i++) list.push(await spawnBot(i));

      await new Promise((r) => setTimeout(r, 800));
      const b0 = list.reduce((a, b) => a + b.bytes(), 0);
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 2000));
      const dt = (performance.now() - t0) / 1000;
      const b1 = list.reduce((a, b) => a + b.bytes(), 0);

      const r = await fetch(`${BASE}/api/metrics`);
      const txt = await r.text();
      const m = txt.trim().startsWith("{")
        ? JSON.parse(txt)
        : { rssMb: 0, eventLoopUtilization: 0, rooms: [] };
      const p99 =
        m.rooms?.find(
          (x: { id?: string; p99DurationMs?: number }) =>
            x.id === "training-range",
        )?.p99DurationMs ??
        m.rooms?.[0]?.p99DurationMs ??
        0;
      const elu = (m.eventLoopUtilization ?? 0) * 100;
      const rss = m.rssMb ?? 0;
      const kbps = (b1 - b0) / 1024 / dt;

      console.log(
        `| ${String(n).padStart(7)} | ${p99.toFixed(2).padStart(13)} | ${elu.toFixed(1).padStart(7)} | ${rss.toFixed(1).padStart(8)} | ${kbps.toFixed(1).padStart(9)} | ${(p99 < 33.3 ? "YES" : "NO").padStart(16)} |`,
      );

      for (const b of list) b.close();
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    child.kill();
  }
}

void main();
