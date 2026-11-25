import type { ParticleSystem } from "../render/particles.js";
import type { GameConnection } from "./connection.js";
import type { NetworkSession } from "./predictor.js";

export function mountNetgraphView(params: {
	connection: GameConnection;
	session: NetworkSession;
	particles: ParticleSystem;
	getRoomId: () => string;
}): {
	show: () => void;
	hide: () => void;
	recordFrameMs: (ms: number) => void;
} {
	const { connection, session, particles, getRoomId } = params;
	const frameSamples: number[] = [];

	const box = document.createElement("div");
	box.id = "netgraph-panel";
	Object.assign(box.style, {
		position: "fixed",
		bottom: "14px",
		left: "14px",
		width: "390px",
		background: "rgba(15, 23, 42, 0.9)",
		border: "1px solid rgba(56, 189, 248, 0.35)",
		borderRadius: "8px",
		padding: "10px 12px",
		fontFamily: "monospace",
		fontSize: "11.5px",
		color: "#e2e8f0",
		zIndex: "15",
		display: "none",
	});

	box.innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-weight:bold; color:#38bdf8;">
      <span>NETGRAPH // V8 & 30Hz PROFILER</span>
      <span id="ng-codec-badge">BINARY (DataView)</span>
    </div>
    <div id="ng-metrics" style="line-height:1.55; color:#cbd5e1; margin-bottom:8px;"></div>
    <div style="display:flex; flex-wrap:wrap; gap:6px;">
      <button id="ng-btn-pred" type="button" style="padding:4px 8px; background:#16a34a; color:#fff; border:none; border-radius:4px; cursor:pointer; font-family:inherit; font-size:11px;">
        Prediction: ON
      </button>
      <button id="ng-btn-lag" type="button" style="padding:4px 8px; background:#334155; color:#f8fafc; border:1px solid #475569; border-radius:4px; cursor:pointer; font-family:inherit; font-size:11px;">
        Inject Lag: OFF
      </button>
      <button id="ng-btn-bots" type="button" style="padding:4px 8px; background:#0284c7; color:#fff; border:none; border-radius:4px; cursor:pointer; font-family:inherit; font-size:11px;">
        + 8 Bots
      </button>
      <button id="ng-btn-worker" type="button" style="padding:4px 8px; background:#7c3aed; color:#fff; border:none; border-radius:4px; cursor:pointer; font-family:inherit; font-size:11px;">
        Particles: Worker
      </button>
    </div>
  `;

	document.body.appendChild(box);

	const codecBadge = box.querySelector<HTMLElement>("#ng-codec-badge");
	const metricsEl = box.querySelector<HTMLElement>("#ng-metrics");
	const predBtn = box.querySelector<HTMLButtonElement>("#ng-btn-pred");
	const lagBtn = box.querySelector<HTMLButtonElement>("#ng-btn-lag");
	const botsBtn = box.querySelector<HTMLButtonElement>("#ng-btn-bots");
	const workerBtn = box.querySelector<HTMLButtonElement>("#ng-btn-worker");

	let lagEnabled = false;

	predBtn?.addEventListener("click", () => {
		session.predictionEnabled = !session.predictionEnabled;
		predBtn.textContent = `Prediction: ${session.predictionEnabled ? "ON" : "OFF"}`;
		predBtn.style.background = session.predictionEnabled
			? "#16a34a"
			: "#dc2626";
	});

	lagBtn?.addEventListener("click", () => {
		lagEnabled = !lagEnabled;
		lagBtn.textContent = lagEnabled
			? "Lag: 100ms ±30ms (2%)"
			: "Inject Lag: OFF";
		lagBtn.style.background = lagEnabled ? "#d97706" : "#334155";
		connection.send("netSim", {
			latencyMs: lagEnabled ? 100 : 0,
			jitterMs: lagEnabled ? 30 : 0,
			dropRate: lagEnabled ? 0.02 : 0,
		});
	});

	botsBtn?.addEventListener("click", async () => {
		const roomId = getRoomId();
		if (!roomId) return;
		botsBtn.disabled = true;
		try {
			await fetch(`/api/rooms/${encodeURIComponent(roomId)}/bots`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ count: 8 }),
			});
		} finally {
			botsBtn.disabled = false;
		}
	});

	workerBtn?.addEventListener("click", () => {
		particles.useWorker = !particles.useWorker;
		workerBtn.textContent = `Particles: ${particles.useWorker ? "Worker" : "MainThread"}`;
		workerBtn.style.background = particles.useWorker ? "#7c3aed" : "#334155";
	});

	let updateTimer: ReturnType<typeof setInterval> | null = null;

	return {
		recordFrameMs(ms: number) {
			frameSamples.push(ms);
			if (frameSamples.length > 300) {
				frameSamples.shift();
			}
		},
		show() {
			box.style.display = "block";
			if (codecBadge) {
				codecBadge.textContent =
					connection.codec === "binary" ? "BINARY (DataView)" : "JSON (Text)";
			}
			if (updateTimer === null) {
				updateTimer = setInterval(() => {
					if (!metricsEl) return;
					const rxKb = (connection.bytesInPerSec / 1024).toFixed(2);
					const txKb = (connection.bytesOutPerSec / 1024).toFixed(2);

					const sorted = [...frameSamples].sort((a, b) => a - b);
					const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
					const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
					const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;

					metricsEl.innerHTML = `
            RTT: <b>${connection.rttMs.toFixed(1)} ms</b> | Traffic: <b>↓ ${rxKb} / ↑ ${txKb} KB/s</b><br/>
            Frame p50/p95/p99: <b>${p50.toFixed(2)} / ${p95.toFixed(2)} / <span style="color:${p99 < 16.7 ? "#4ade80" : "#f87171"};">${p99.toFixed(2)} ms</span></b><br/>
            Pending: <b>${session.pendingInputs.length}</b> | Reconcile: <b>${session.lastCorrectionPx.toFixed(2)} px</b> | Particles: <b>${particles.lastStepUs.toFixed(0)} µs</b>
          `;
				}, 150);
			}
		},
		hide() {
			box.style.display = "none";
			if (updateTimer !== null) {
				clearInterval(updateTimer);
				updateTimer = null;
			}
		},
	};
}
