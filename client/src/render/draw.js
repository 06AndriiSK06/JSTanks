function lerp(a, b, t) {
	return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
	let diff = b - a;
	while (diff > Math.PI) diff -= Math.PI * 2;
	while (diff < -Math.PI) diff += Math.PI * 2;
	return a + diff * t;
}

export function getInterpolatedPose(entity, alpha, arena) {
	const dx = Math.abs(entity.pos.x - entity.prevPos.x);
	const dy = Math.abs(entity.pos.y - entity.prevPos.y);

	const x =
		dx > arena.width * 0.5
			? entity.pos.x
			: lerp(entity.prevPos.x, entity.pos.x, alpha);
	const y =
		dy > arena.height * 0.5
			? entity.pos.y
			: lerp(entity.prevPos.y, entity.pos.y, alpha);
	const angle = lerpAngle(entity.prevAngle, entity.angle, alpha);

	return { x, y, angle };
}

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
			"Click anywhere or press [R] to RETRY (or [Enter] to continue degraded)",
			cx,
			cy + 62,
		);
	} else if (state.elapsedMs != null) {
		ctx.fillStyle = "#4ade80";
		ctx.font = "12px monospace";
		ctx.fillText(
			`Loaded (${state.mode}) in ${state.elapsedMs.toFixed(1)} ms`,
			cx,
			cy + 36,
		);
	}
	ctx.restore();
}

export function drawArena(ctx, arena) {
	ctx.fillStyle = "#0f172a";
	ctx.fillRect(0, 0, arena.width, arena.height);

	ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
	ctx.lineWidth = 1;
	const gridSize = arena.gridSize ?? 48;

	ctx.beginPath();
	for (let x = 0; x <= arena.width; x += gridSize) {
		ctx.moveTo(x, 0);
		ctx.lineTo(x, arena.height);
	}
	for (let y = 0; y <= arena.height; y += gridSize) {
		ctx.moveTo(0, y);
		ctx.lineTo(arena.width, y);
	}
	ctx.stroke();
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

export function drawShip(ctx, ship, pose, assets) {
	if (!ship.isSpawned()) return;

	ctx.save();
	ctx.translate(pose.x, pose.y);

	if (ship.shieldTimer > 0) {
		ctx.beginPath();
		ctx.arc(0, 0, ship.radius + 9, 0, Math.PI * 2);
		ctx.strokeStyle = "rgba(56, 189, 248, 0.75)";
		ctx.lineWidth = 2.5;
		ctx.stroke();
		ctx.fillStyle = "rgba(56, 189, 248, 0.12)";
		ctx.fill();
	}

	ctx.rotate(pose.angle);

	if (ship.thrusting) {
		ctx.fillStyle = "#f97316";
		ctx.beginPath();
		ctx.moveTo(-20, -6);
		ctx.lineTo(-31 - Math.random() * 6, 0);
		ctx.lineTo(-20, 6);
		ctx.closePath();
		ctx.fill();
	}

	const frameKey = ship.rapidFireTimer > 0 ? "shipRapid" : "ship";
	const drawn = drawSpriteFrame(ctx, assets, frameKey, 56);

	if (!drawn) {
		ctx.fillStyle = "#334155";
		ctx.fillRect(-20, -16, 40, 6);
		ctx.fillRect(-20, 10, 40, 6);
		ctx.fillStyle = ship.rapidFireTimer > 0 ? "#a855f7" : "#22c55e";
		ctx.fillRect(-16, -11, 32, 22);
		ctx.fillStyle = "#94a3b8";
		ctx.fillRect(4, -3, 22, 6);
	}

	ctx.restore();
}

export function drawBullet(ctx, bullet, pose, assets) {
	ctx.save();
	ctx.translate(pose.x, pose.y);
	ctx.rotate(pose.angle);

	const frameKey = bullet.isMissile ? "missile" : "bullet";
	const spriteSize = bullet.isMissile ? 34 : 24;
	const drawn = drawSpriteFrame(ctx, assets, frameKey, spriteSize);

	if (!drawn) {
		ctx.fillStyle = bullet.isMissile ? "#f43f5e" : "#38bdf8";
		ctx.beginPath();
		ctx.arc(0, 0, bullet.radius, 0, Math.PI * 2);
		ctx.fill();
	}

	ctx.restore();
}

export function drawAsteroid(ctx, asteroid, pose, assets) {
	ctx.save();
	ctx.translate(pose.x, pose.y);
	ctx.rotate(pose.angle);

	const frameKey = asteroid.homing ? "asteroidSeeker" : "asteroid";
	const spriteSize = asteroid.radius * 2.55;
	const drawn = drawSpriteFrame(ctx, assets, frameKey, spriteSize);

	if (!drawn) {
		ctx.beginPath();
		asteroid.vertices.forEach((v, idx) => {
			const vx = Math.cos(v.angle) * v.dist;
			const vy = Math.sin(v.angle) * v.dist;
			if (idx === 0) ctx.moveTo(vx, vy);
			else ctx.lineTo(vx, vy);
		});
		ctx.closePath();
		ctx.fillStyle = asteroid.homing ? "#3f1d2e" : "#1e293b";
		ctx.strokeStyle = asteroid.homing ? "#f43f5e" : "#94a3b8";
		ctx.lineWidth = 2;
		ctx.fill();
		ctx.stroke();
	}

	ctx.restore();
}

export function drawPickup(ctx, pickup) {
	const bob = Math.sin(pickup.pulse) * 2.5;
	const isShield = pickup.pickupType === "shield";

	ctx.save();
	ctx.translate(pickup.pos.x, pickup.pos.y);

	ctx.beginPath();
	ctx.arc(0, 0, pickup.radius + bob, 0, Math.PI * 2);
	ctx.fillStyle = isShield
		? "rgba(56, 189, 248, 0.18)"
		: "rgba(168, 85, 247, 0.18)";
	ctx.strokeStyle = isShield ? "#38bdf8" : "#a855f7";
	ctx.lineWidth = 2;
	ctx.fill();
	ctx.stroke();

	ctx.fillStyle = "#f8fafc";
	ctx.font = "bold 12px monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(isShield ? "+HP" : "2X", 0, 0);

	ctx.restore();
}

export function drawExplosion(ctx, explosion) {
	const alpha = Math.max(0, explosion.ttl / explosion.maxTtl);
	ctx.save();
	ctx.globalAlpha = alpha;
	for (const p of explosion.particles) {
		ctx.fillStyle = p.color;
		ctx.beginPath();
		ctx.arc(
			explosion.pos.x + p.offset.x,
			explosion.pos.y + p.offset.y,
			p.size * alpha,
			0,
			Math.PI * 2,
		);
		ctx.fill();
	}
	ctx.restore();
}

export function drawWorld(ctx, world, alpha, assets) {
	drawArena(ctx, world.arena);

	for (const entity of world) {
		if (!entity.alive) continue;
		const pose = getInterpolatedPose(entity, alpha, world.arena);

		switch (entity.kind) {
			case "pickup":
				drawPickup(ctx, entity);
				break;
			case "asteroid":
				drawAsteroid(ctx, entity, pose, assets);
				break;
			case "bullet":
				drawBullet(ctx, entity, pose, assets);
				break;
			case "ship":
				drawShip(ctx, entity, pose, assets);
				break;
			case "explosion":
				drawExplosion(ctx, entity);
				break;
			default:
				break;
		}
	}
}

export function createHudRenderer() {
	let scoreFlashTimer = 0;
	let lastDelta = 0;

	return {
		bindWorld(world) {
			world.addEventListener("scoreChanged", (e) => {
				scoreFlashTimer = 0.8;
				lastDelta = e.detail?.delta ?? 0;
			});
		},
		draw(ctx, stats, world, ship, audio) {
			if (scoreFlashTimer > 0) {
				scoreFlashTimer = Math.max(0, scoreFlashTimer - 1 / 60);
			}

			ctx.save();
			ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
			ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.roundRect(14, 14, 390, 148, 8);
			ctx.fill();
			ctx.stroke();

			ctx.font = "13px monospace";
			ctx.fillStyle = "#38bdf8";
			ctx.fillText(
				`PILOT: ${world.playerName} | ROOM: ${world.roomName}`,
				26,
				36,
			);

			ctx.fillStyle = "#e2e8f0";
			const deltaStr = scoreFlashTimer > 0 ? ` (+${lastDelta})` : "";
			ctx.fillText(
				`SCORE: ${world.score}${deltaStr}   WAVE: ${world.wave}`,
				26,
				58,
			);

			const hpText = ship.isSpawned()
				? `HP: ${ship.hp} / ${ship.maxHp}`
				: `RESPAWN IN ${ship.respawnTimer.toFixed(1)}s`;
			ctx.fillStyle = ship.hp > 40 ? "#4ade80" : "#f87171";
			ctx.fillText(hpText, 26, 80);

			const buffs = [];
			if (ship.shieldTimer > 0)
				buffs.push(`SHIELD ${ship.shieldTimer.toFixed(1)}s`);
			if (ship.rapidFireTimer > 0)
				buffs.push(`RAPID ${ship.rapidFireTimer.toFixed(1)}s`);
			ctx.fillStyle = "#a855f7";
			ctx.fillText(
				buffs.length > 0 ? `BUFFS: ${buffs.join(" | ")}` : "BUFFS: NONE",
				26,
				102,
			);

			ctx.fillStyle = "#94a3b8";
			const muteLabel = audio?.isMuted() ? "MUTED [M]" : "AUDIO ON [M]";
			ctx.fillText(
				`${stats.stepsPerSec} Hz | ${stats.framesPerSec} fps | ${muteLabel}`,
				26,
				124,
			);
			ctx.fillText(
				"WASD: drive | Space: cannon | E: homing | M: mute",
				26,
				144,
			);
			ctx.restore();
		},
	};
}
