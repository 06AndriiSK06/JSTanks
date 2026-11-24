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

export function drawArena(ctx, arena) {
	ctx.fillStyle = "#0f172a";
	ctx.fillRect(0, 0, arena.width, arena.height);

	ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
	ctx.lineWidth = 1;
	const gridSize = 48;

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

export function drawShip(ctx, ship, pose) {
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

	ctx.fillStyle = "#334155";
	ctx.fillRect(-20, -16, 40, 6);
	ctx.fillRect(-20, 10, 40, 6);

	ctx.fillStyle = ship.rapidFireTimer > 0 ? "#a855f7" : "#22c55e";
	ctx.strokeStyle = "#15803d";
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.roundRect(-16, -11, 32, 22, 4);
	ctx.fill();
	ctx.stroke();

	ctx.fillStyle = "#94a3b8";
	ctx.fillRect(4, -3, 22, 6);

	ctx.fillStyle = ship.rapidFireTimer > 0 ? "#7e22ce" : "#16a34a";
	ctx.beginPath();
	ctx.arc(0, 0, 8, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();

	ctx.restore();
}

export function drawBullet(ctx, bullet, pose) {
	ctx.save();
	ctx.translate(pose.x, pose.y);
	ctx.rotate(pose.angle);

	if (bullet.isMissile) {
		ctx.fillStyle = "#f43f5e";
		ctx.beginPath();
		ctx.moveTo(8, 0);
		ctx.lineTo(-6, -4);
		ctx.lineTo(-4, 0);
		ctx.lineTo(-6, 4);
		ctx.closePath();
		ctx.fill();

		ctx.fillStyle = "#fde047";
		ctx.beginPath();
		ctx.arc(-6, 0, 2.5, 0, Math.PI * 2);
		ctx.fill();
	} else {
		ctx.fillStyle = "#38bdf8";
		ctx.beginPath();
		ctx.arc(0, 0, bullet.radius, 0, Math.PI * 2);
		ctx.fill();
	}

	ctx.restore();
}

export function drawAsteroid(ctx, asteroid, pose) {
	ctx.save();
	ctx.translate(pose.x, pose.y);
	ctx.rotate(pose.angle);

	ctx.beginPath();
	asteroid.vertices.forEach((v, idx) => {
		const vx = Math.cos(v.angle) * v.dist;
		const vy = Math.sin(v.angle) * v.dist;
		if (idx === 0) ctx.moveTo(vx, vy);
		else ctx.lineTo(vx, vy);
	});
	ctx.closePath();

	// Дрони-астероїди з homing підсвічуються червоним контуром
	ctx.fillStyle = asteroid.homing ? "#3f1d2e" : "#1e293b";
	ctx.strokeStyle = asteroid.homing ? "#f43f5e" : "#94a3b8";
	ctx.lineWidth = 2;
	ctx.fill();
	ctx.stroke();

	if (asteroid.homing) {
		ctx.fillStyle = "#f43f5e";
		ctx.beginPath();
		ctx.arc(0, 0, 4, 0, Math.PI * 2);
		ctx.fill();
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

export function drawWorld(ctx, world, alpha) {
	drawArena(ctx, world.arena);

	for (const entity of world) {
		if (!entity.alive) continue;
		const pose = getInterpolatedPose(entity, alpha, world.arena);

		switch (entity.kind) {
			case "pickup":
				drawPickup(ctx, entity);
				break;
			case "asteroid":
				drawAsteroid(ctx, entity, pose);
				break;
			case "bullet":
				drawBullet(ctx, entity, pose);
				break;
			case "ship":
				drawShip(ctx, entity, pose);
				break;
			case "explosion":
				drawExplosion(ctx, entity);
				break;
			default:
				break;
		}
	}
}

export function drawHud(ctx, stats, world, ship) {
	ctx.save();
	ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
	ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.roundRect(14, 14, 340, 126, 8);
	ctx.fill();
	ctx.stroke();

	ctx.font = "13px monospace";
	ctx.fillStyle = "#e2e8f0";
	ctx.fillText(
		`SCORE: ${world.score}   WAVE: ${world.wave}   ENTITIES: ${world.size}`,
		26,
		36,
	);

	const hpText = ship.isSpawned()
		? `HP: ${ship.hp} / ${ship.maxHp}`
		: `RESPAWN IN ${ship.respawnTimer.toFixed(1)}s`;
	ctx.fillStyle = ship.hp > 40 ? "#4ade80" : "#f87171";
	ctx.fillText(hpText, 26, 58);

	const buffs = [];
	if (ship.shieldTimer > 0)
		buffs.push(`SHIELD ${ship.shieldTimer.toFixed(1)}s`);
	if (ship.rapidFireTimer > 0)
		buffs.push(`RAPID ${ship.rapidFireTimer.toFixed(1)}s`);
	ctx.fillStyle = "#38bdf8";
	ctx.fillText(
		buffs.length > 0 ? `BUFFS: ${buffs.join(" | ")}` : "BUFFS: NONE",
		26,
		80,
	);

	ctx.fillStyle = "#94a3b8";
	ctx.fillText(
		`steps/s: ${stats.stepsPerSec} Hz | frames/s: ${stats.framesPerSec} fps`,
		26,
		104,
	);
	ctx.fillText("WASD: drive | Space: cannon | E: homing missile", 26, 124);
	ctx.restore();
}
