export function mountLobbyView(lobby) {
	const overlay = document.createElement("div");
	overlay.id = "lobby-overlay";
	Object.assign(overlay.style, {
		position: "fixed",
		inset: "0",
		display: "none",
		alignItems: "center",
		justifyContent: "center",
		background: "rgba(15, 23, 42, 0.88)",
		backdropFilter: "blur(6px)",
		zIndex: "20",
		fontFamily: "monospace",
		color: "#e2e8f0",
	});

	overlay.innerHTML = `
    <div style="width: 480px; max-width: 92vw; background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
        <h2 style="margin:0; font-size: 20px; color: #38bdf8;">JSTANKS // BATTLE LOBBY</h2>
        <button id="lobby-refresh-btn" type="button" style="background:#334155; color:#e2e8f0; border:1px solid #475569; border-radius:6px; padding:6px 10px; cursor:pointer; font-family:inherit;">Refresh</button>
      </div>

      <label style="display:block; margin-bottom: 14px; font-size: 13px; color: #94a3b8;">
        CALLSIGN (PLAYER NAME)
        <input id="lobby-player-name" type="text" value="Andrii" maxlength="20"
          style="display:block; width:100%; box-sizing:border-box; margin-top:6px; padding:10px 12px; background:#0f172a; border:1px solid #475569; border-radius:6px; color:#f8fafc; font-family:inherit; font-size:14px;" />
      </label>

      <div style="font-size: 13px; color: #94a3b8; margin-bottom: 8px;">SELECT ARENA ROOM</div>
      <div id="lobby-rooms-list" style="display:flex; flex-direction:column; gap:8px; margin-bottom: 14px; min-height: 150px;"></div>

      <div id="lobby-status" style="font-size: 12px; color: #94a3b8; margin-bottom: 16px; min-height: 18px;"></div>

      <button id="lobby-join-btn" type="button"
        style="width:100%; padding:12px; background:#22c55e; color:#052e16; font-weight:bold; font-size:15px; border:none; border-radius:8px; cursor:pointer; font-family:inherit;">
        JOIN BATTLE
      </button>
    </div>
  `;

	document.body.appendChild(overlay);

	const nameInput = overlay.querySelector("#lobby-player-name");
	const roomsList = overlay.querySelector("#lobby-rooms-list");
	const statusEl = overlay.querySelector("#lobby-status");
	const refreshBtn = overlay.querySelector("#lobby-refresh-btn");
	const joinBtn = overlay.querySelector("#lobby-join-btn");

	nameInput.addEventListener("input", () => {
		lobby.playerName = nameInput.value;
	});

	refreshBtn.addEventListener("click", () => {
		lobby.refresh();
	});

	joinBtn.addEventListener("click", () => {
		lobby.join(lobby.selectedRoomId, nameInput.value);
	});

	function renderRooms(rooms) {
		roomsList.innerHTML = "";
		for (const room of rooms) {
			const selected = room.id === lobby.selectedRoomId;
			const item = document.createElement("button");
			item.type = "button";
			Object.assign(item.style, {
				textAlign: "left",
				padding: "10px 12px",
				background: selected ? "rgba(56, 189, 248, 0.16)" : "#0f172a",
				border: selected ? "1px solid #38bdf8" : "1px solid #334155",
				borderRadius: "8px",
				color: "#f8fafc",
				cursor: "pointer",
				fontFamily: "inherit",
			});
			item.innerHTML = `
        <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:14px;">
          <span>${room.name}</span>
          <span style="color:#38bdf8;">${room.players}/${room.maxPlayers}</span>
        </div>
        <div style="font-size:12px; color:#94a3b8; margin-top:4px;">
          Difficulty: ${room.difficulty} | Asteroids: ${room.initialAsteroids}
        </div>
      `;
			item.addEventListener("click", () => {
				lobby.selectedRoomId = room.id;
				renderRooms(lobby.rooms);
			});
			roomsList.appendChild(item);
		}
	}

	lobby.addEventListener("roomsChanged", (e) => {
		renderRooms(e.detail.rooms);
		statusEl.style.color = "#4ade80";
		statusEl.textContent = `Synced with /api/rooms.json at ${e.detail.updatedAt}`;
	});

	lobby.addEventListener("status", (e) => {
		if (e.detail.error) {
			statusEl.style.color = "#f87171";
			statusEl.textContent = `Warning: ${e.detail.error} (you can still Join offline)`;
		} else if (e.detail.loading) {
			statusEl.style.color = "#94a3b8";
			statusEl.textContent = "Fetching open rooms...";
		}
	});

	lobby.addEventListener("join", () => {
		overlay.style.display = "none";
	});

	return {
		show() {
			overlay.style.display = "flex";
		},
		hide() {
			overlay.style.display = "none";
		},
	};
}
