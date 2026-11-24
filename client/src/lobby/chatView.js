export function mountRoomChatView(connection) {
	const panel = document.createElement("div");
	panel.id = "room-chat-panel";
	Object.assign(panel.style, {
		position: "fixed",
		top: "14px",
		right: "14px",
		width: "330px",
		maxWidth: "42vw",
		background: "rgba(15, 23, 42, 0.85)",
		border: "1px solid rgba(148, 163, 184, 0.28)",
		borderRadius: "8px",
		padding: "12px",
		fontFamily: "monospace",
		color: "#e2e8f0",
		fontSize: "12px",
		zIndex: "15",
		display: "none",
	});

	panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
      <span style="font-weight:bold; color:#38bdf8;">ROOM ROSTER & CHAT</span>
      <span id="ws-conn-badge" style="color:#4ade80;">WS: ONLINE</span>
    </div>
    <div id="room-roster-list" style="color:#cbd5e1; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #334155;">
      Players: connecting...
    </div>
    <div id="room-chat-log" style="height:125px; overflow-y:auto; display:flex; flex-direction:column; gap:4px; margin-bottom:8px; padding-right:4px;"></div>
    <form id="room-chat-form" style="display:flex; gap:6px;">
      <input id="room-chat-input" type="text" placeholder="Press Enter to chat..." maxlength="280"
        style="flex:1; padding:6px 8px; background:#0f172a; border:1px solid #475569; border-radius:4px; color:#f8fafc; font-family:inherit; font-size:12px;" />
      <button type="submit" style="padding:6px 10px; background:#38bdf8; color:#0f172a; font-weight:bold; border:none; border-radius:4px; cursor:pointer; font-family:inherit;">
        Send
      </button>
    </form>
  `;

	document.body.appendChild(panel);

	const badgeEl = panel.querySelector("#ws-conn-badge");
	const rosterEl = panel.querySelector("#room-roster-list");
	const logEl = panel.querySelector("#room-chat-log");
	const formEl = panel.querySelector("#room-chat-form");
	const inputEl = panel.querySelector("#room-chat-input");

	function appendLine(html, color = "#e2e8f0") {
		const row = document.createElement("div");
		row.style.color = color;
		row.style.wordBreak = "break-word";
		row.innerHTML = html;
		logEl.appendChild(row);
		logEl.scrollTop = logEl.scrollHeight;
	}

	function updateRoster(players = []) {
		if (players.length === 0) {
			rosterEl.textContent = "Players (0): none";
			return;
		}
		const names = players.map((p) => p.name).join(", ");
		rosterEl.textContent = `Players (${players.length}): ${names}`;
	}

	formEl.addEventListener("submit", (e) => {
		e.preventDefault();
		const text = inputEl.value.trim();
		if (!text) return;
		connection.send("chat", { text });
		inputEl.value = "";
		inputEl.blur();
	});

	// Клавіша Enter відкриває/фокусує поле чату, Escape знімає фокус для керування танком
	window.addEventListener("keydown", (e) => {
		if (panel.style.display === "none") return;
		if (e.code === "Enter" && document.activeElement !== inputEl) {
			e.preventDefault();
			inputEl.focus();
		} else if (e.code === "Escape" && document.activeElement === inputEl) {
			inputEl.blur();
		}
	});

	connection.addEventListener("connected", () => {
		badgeEl.style.color = "#4ade80";
		badgeEl.textContent = "WS: ONLINE";
	});

	connection.addEventListener("disconnected", () => {
		badgeEl.style.color = "#f87171";
		badgeEl.textContent = "WS: OFFLINE";
	});

	connection.addEventListener("reconnecting", (e) => {
		badgeEl.style.color = "#fde047";
		badgeEl.textContent = `WS: RETRY #${e.detail.attempt}`;
	});

	connection.addEventListener("welcome", (e) => {
		updateRoster(e.detail.players);
		appendLine(
			`Connected to <b>${e.detail.room?.name ?? "Room"}</b>`,
			"#38bdf8",
		);
	});

	connection.addEventListener("roster", (e) => {
		updateRoster(e.detail.players);
		if (e.detail.systemNotice) {
			appendLine(`* ${e.detail.systemNotice}`, "#94a3b8");
		}
	});

	connection.addEventListener("chat", (e) => {
		const safeName = String(e.detail.name ?? "Pilot").replace(/</g, "&lt;");
		const safeText = String(e.detail.text ?? "").replace(/</g, "&lt;");
		appendLine(`<b style="color:#4ade80;">${safeName}:</b> ${safeText}`);
	});

	return {
		show() {
			panel.style.display = "block";
		},
		isTyping() {
			return document.activeElement === inputEl;
		},
	};
}
