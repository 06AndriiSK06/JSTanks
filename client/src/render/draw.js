export function drawLoadingScreen(ctx, arena, state) {
	ctx.fillStyle = "#0f172a";
	ctx.fillRect(0, 0, arena.width, arena.height);

	const cx = arena.width / 2;
	const cy = arena.height / 2;
	const barW = Math.min(460, arena.width - 60);
	const barH = 22;

	ctx.save();
	ctx.textAlign = "center";
	ctx.font = "bold 22px monospace";
	ctx.fillStyle = "#38bdf8";
	ctx.fillText("JSTANKS // ASSET PIPELINE", cx, cy - 64);

	ctx.font = "13px monospace";
	ctx.fillStyle = "#94a3b8";
	ctx.fillText(state.label || "Initializing...", cx, cy - 32);

	ctx.fillStyle = "#1e293b";
	ctx.strokeStyle = state.error ? "#ef4444" : "#334155";
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.roundRect(cx - barW / 2, cy - barH / 2, barW, barH, 6);
	ctx.fill();
	ctx.stroke();

	const ratio = Math.max(0, Math.min(1, state.ratio ?? 0));
	if (ratio > 0) {
		ctx.fillStyle = state.error ? "#ef4444" : "#22c55e";
		ctx.beginPath();
		ctx.roundRect(
			cx - barW / 2 + 3,
			cy - barH / 2 + 3,
			(barW - 6) * ratio,
			barH - 6,
			4,
		);
		ctx.fill();
	}

	ctx.fillStyle = "#f8fafc";
	ctx.font = "bold 12px monospace";
	ctx.fillText(
		`${Math.round(ratio * 100)}% (${state.done ?? 0}/${state.total ?? 0})`,
		cx,
		cy + 4,
	);

	if (state.error) {
		ctx.fillStyle = "#f87171";
		ctx.font = "13px monospace";
		ctx.fillText(`ERROR: ${state.error}`, cx, cy + 38);
		ctx.fillStyle = "#fde047";
		ctx.fillText(
			"Click anywhere or press [R] to RETRY (or [Enter] to continue)",
			cx,
			cy + 62,
		);
	}
	ctx.restore();
}

function drawSpriteFrame(ctx, assets, frameKey, size) {
	const sheet = assets?.spriteSheet;
	const frame = assets?.spriteMeta?.frames?.[frameKey];
	if (!sheet || !frame || !sheet.complete || sheet.naturalWidth === 0) {
		return false;
	}
	ctx.drawImage(
		sheet,
		frame.sx,
		frame.sy,
		frame.sw,
		frame.sh,
		-size / 2,
		-size / 2,
		size,
		size,
	);
	return true;
}

export function drawMultiplayerWorld(
	ctx,
	canvasArena,
	simArena,
	entities,
	assets,
) {
	ctx.fillStyle = "#0f172a";
	ctx.fillRect(0, 0, canvasArena.width, canvasArena.height);

	const offsetX = Math.floor((canvasArena.width - simArena.width) / 2);
	const offsetY = Math.floor((canvasArena.height - simArena.height) / 2);

	ctx.save();
	ctx.translate(offsetX, offsetY);

	ctx.fillStyle = "#0b1222";
	ctx.fillRect(0, 0, simArena.width, simArena.height);
	ctx.strokeStyle = "#334155";
	ctx.lineWidth = 2;
	ctx.strokeRect(0, 0, simArena.width, simArena.height);

	ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let x = 0; x <= simArena.width; x += 48) {
		ctx.moveTo(x, 0);
		ctx.lineTo(x, simArena.height);
	}
	for (let y = 0; y <= simArena.height; y += 48) {
		ctx.moveTo(0, y);
		ctx.lineTo(simArena.width, y);
	}
	ctx.stroke();

	for (const e of entities) {
		if (e.kind === "pickup") {
			const isShield = e.pickupType === "shield";
			ctx.save();
			ctx.translate(e.x, e.y);
			ctx.beginPath();
			ctx.arc(0, 0, 15, 0, Math.PI * 2);
			ctx.fillStyle = isShield
				? "rgba(56, 189, 248, 0.2)"
				: "rgba(168, 85, 247, 0.2)";
			ctx.strokeStyle = isShield ? "#38bdf8" : "#a855f7";
			ctx.lineWidth = 2;
			ctx.fill();
			ctx.stroke();
			ctx.fillStyle = "#f8fafc";
			ctx.font = "bold 11px monospace";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(isShield ? "+HP" : "2X", 0, 0);
			ctx.restore();
			continue;
		}

		if (e.kind === "asteroid") {
			const radius = e.size === 2 ? 26 : 15;
			ctx.save();
			ctx.translate(e.x, e.y);
			ctx.rotate(e.angle);
			const frameKey = e.isSeeker ? "asteroidSeeker" : "asteroid";
			if (!drawSpriteFrame(ctx, assets, frameKey, radius * 2.55)) {
				ctx.fillStyle = e.isSeeker ? "#3f1d2e" : "#1e293b";
				ctx.strokeStyle = e.isSeeker ? "#f43f5e" : "#94a3b8";
				ctx.beginPath();
				ctx.arc(0, 0, radius, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			}
			ctx.restore();
			continue;
		}

		if (e.kind === "bullet") {
			ctx.save();
			ctx.translate(e.x, e.y);
			ctx.rotate(e.angle);
			const frameKey = e.isMissile ? "missile" : "bullet";
			const size = e.isMissile ? 32 : 22;
			if (!drawSpriteFrame(ctx, assets, frameKey, size)) {
				ctx.fillStyle = e.isMissile ? "#f43f5e" : "#38bdf8";
				ctx.beginPath();
				ctx.arc(0, 0, 4, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.restore();
			continue;
		}

		if (e.kind === "ship" && e.isSpawned) {
			ctx.save();
			ctx.translate(e.x, e.y);

			if (e.shieldTimer > 0) {
				ctx.beginPath();
				ctx.arc(0, 0, 26, 0, Math.PI * 2);
				ctx.strokeStyle = "rgba(56, 189, 248, 0.8)";
				ctx.lineWidth = 2.5;
				ctx.stroke();
			}

			ctx.font = "bold 12px monospace";
			ctx.textAlign = "center";
			ctx.fillStyle = e.isLocal ? "#4ade80" : "#38bdf8";
			ctx.fillText(`${e.name} [${e.hp}]`, 0, -28);

			ctx.rotate(e.angle);
			if (e.thrusting) {
				ctx.fillStyle = "#f97316";
				ctx.beginPath();
				ctx.moveTo(-20, -6);
				ctx.lineTo(-32, 0);
				ctx.lineTo(-20, 6);
				ctx.closePath();
				ctx.fill();
			}

			const frameKey =
				!e.isLocal || e.rapidFireTimer > 0 ? "shipRapid" : "ship";
			if (!drawSpriteFrame(ctx, assets, frameKey, 54)) {
				ctx.fillStyle = e.isLocal ? "#22c55e" : "#a855f7";
				ctx.fillRect(-16, -11, 32, 22);
			}

			ctx.restore();
		}
	}

	ctx.restore();
}

export function createHudRenderer() {
	return {
		draw(ctx, stats, roomName, localShip, audio) {
			ctx.save();
			ctx.fillStyle = "rgba(15, 23, 42, 0.84)";
			ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.roundRect(14, 14, 380, 126, 8);
			ctx.fill();
			ctx.stroke();

			ctx.font = "13px monospace";
			ctx.fillStyle = "#38bdf8";
			ctx.fillText(`ROOM: ${roomName}`, 26, 36);

			const score = localShip?.score ?? 0;
			const hp = localShip?.hp ?? 100;
			ctx.fillStyle = "#e2e8f0";
			ctx.fillText(
				`PILOT: ${localShip?.name ?? "Connecting..."} | SCORE: ${score}`,
				26,
				58,
			);

			ctx.fillStyle = hp > 40 ? "#4ade80" : "#f87171";
			ctx.fillText(
				localShip && !localShip.isSpawned()
					? "STATUS: RESPAWNING..."
					: `ARMOR HP: ${hp} / 100`,
				26,
				80,
			);

			ctx.fillStyle = "#94a3b8";
			const muteLabel = audio?.isMuted() ? "MUTED [M]" : "AUDIO ON [M]";
			ctx.fillText(
				`Render: ${stats.framesPerSec} fps | Server: 30 Hz | ${muteLabel}`,
				26,
				102,
			);
			ctx.fillText(
				"WASD: drive | Space: fire | E: missile | Enter: chat",
				26,
				122,
			);
			ctx.restore();
		},
	};
}
