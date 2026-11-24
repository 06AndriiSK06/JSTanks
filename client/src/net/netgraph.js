export function mountNetgraphView({ connection, session }) {
	const box = document.createElement("div");
	box.id = "netgraph-panel";
	Object.assign(box.style, {
		position: "fixed",
		bottom: "14px",
		left: "14px",
		width: "365px",
		background: "rgba(15, 23, 42, 0.88)",
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
      <span>NETGRAPH // 30Hz AUTHORITATIVE</span>
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
      <button id="ng-btn-interp" type="button" style="padding:4px 8px; background:#334155; color:#f8fafc; border:1px solid #475569; border-radius:4px; cursor:pointer; font-family:inherit; font-size:11px;">
        Interp: 75ms
      </button>
      <button id="ng-btn-det" type="button" style="padding:4px 8px; background:#334155; color:#f8fafc; border:1px solid #475569; border-radius:4px; cursor:pointer; font-family:inherit; font-size:11px;">
        Break Determinism: OFF
      </button>
    </div>
  `;

	document.body.appendChild(box);

	const codecBadge = box.querySelector("#ng-codec-badge");
	const metricsEl = box.querySelector("#ng-metrics");
	const predBtn = box.querySelector("#ng-btn-pred");
	const lagBtn = box.querySelector("#ng-btn-lag");
	const interpBtn = box.querySelector("#ng-btn-interp");
	const detBtn = box.querySelector("#ng-btn-det");

	let lagEnabled = false;
	const interpSteps = [75, 120, 0];
	let interpIdx = 0;

	predBtn.addEventListener("click", () => {
		session.predictionEnabled = !session.predictionEnabled;
		predBtn.textContent = `Prediction: ${session.predictionEnabled ? "ON" : "OFF"}`;
		predBtn.style.background = session.predictionEnabled
			? "#16a34a"
			: "#dc2626";
	});

	lagBtn.addEventListener("click", () => {
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

	interpBtn.addEventListener("click", () => {
		interpIdx = (interpIdx + 1) % interpSteps.length;
		session.interpolationDelayMs = interpSteps[interpIdx];
		interpBtn.textContent = `Interp: ${session.interpolationDelayMs}ms`;
	});

	detBtn.addEventListener("click", () => {
		session.breakDeterminism = !session.breakDeterminism;
		detBtn.textContent = `Break Determinism: ${session.breakDeterminism ? "ON" : "OFF"}`;
		detBtn.style.background = session.breakDeterminism ? "#dc2626" : "#334155";
	});

	let updateTimer = null;

	return {
		show() {
			box.style.display = "block";
			codecBadge.textContent =
				connection.codec === "binary" ? "BINARY (DataView)" : "JSON (Text)";
			if (updateTimer === null) {
				updateTimer = setInterval(() => {
					const rxKb = (connection.bytesInPerSec / 1024).toFixed(2);
					const txKb = (connection.bytesOutPerSec / 1024).toFixed(2);
					metricsEl.innerHTML = `
            RTT: <b>${connection.rttMs.toFixed(1)} ms</b> | Snap Age: <b>${session.getSnapshotAgeMs()} ms</b> | Tick: <b>${session.serverTick}</b><br/>
            Traffic: <b>↓ ${rxKb} KB/s</b> | <b>↑ ${txKb} KB/s</b><br/>
            Pending Inputs: <b>${session.pendingInputs.length}</b> | Reconcile Correction: <b style="color:${session.lastCorrectionPx > 5 ? "#f87171" : "#4ade80"};">${session.lastCorrectionPx.toFixed(2)} px</b>
          `;
				}, 120);
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
