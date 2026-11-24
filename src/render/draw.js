import { normalizeAngle } from "../sim/ship.js";

function lerp(a, b, alpha) {
	return a + (b - a) * alpha;
}

function lerpAngle(a, b, alpha) {
	const diff = normalizeAngle(b - a);
	return normalizeAngle(a + diff * alpha);
}

export function interpolateState(prev, curr, alpha, arena) {
	const dx = Math.abs(curr.x - prev.x);
	const dy = Math.abs(curr.y - prev.y);
	const wrappedX = dx > arena.width * 0.5;
	const wrappedY = dy > arena.height * 0.5;

	return {
		x: wrappedX ? curr.x : lerp(prev.x, curr.x, alpha),
		y: wrappedY ? curr.y : lerp(prev.y, curr.y, alpha),
		angle: lerpAngle(prev.angle, curr.angle, alpha),
		thrust: curr.thrust,
		boostTimer: curr.boostTimer,
	};
}

export function drawArena(ctx, arena) {
	ctx.fillStyle = "#0f172a";
	ctx.fillRect(0, 0, arena.width, arena.height);

	const gridSize = 48;
	ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
	ctx.lineWidth = 1;
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

	ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
	ctx.lineWidth = 2;
	ctx.strokeRect(1, 1, arena.width - 2, arena.height - 2);
}

export function drawShip(ctx, ship) {
	ctx.save();
	ctx.translate(ship.x, ship.y);
	ctx.rotate(ship.angle);

	if (ship.thrust > 0 || ship.boostTimer > 0) {
		const flameLen = ship.boostTimer > 0 ? 26 : 15;
		ctx.fillStyle = ship.boostTimer > 0 ? "#38bdf8" : "#f97316";
		ctx.beginPath();
		ctx.moveTo(-22, -6);
		ctx.lineTo(-22 - flameLen, 0);
		ctx.lineTo(-22, 6);
		ctx.closePath();
		ctx.fill();
	}

	ctx.fillStyle = "#1e293b";
	ctx.strokeStyle = "#475569";
	ctx.lineWidth = 1.5;
	ctx.fillRect(-22, -18, 44, 7);
	ctx.strokeRect(-22, -18, 44, 7);
	ctx.fillRect(-22, 11, 44, 7);
	ctx.strokeRect(-22, 11, 44, 7);

	ctx.fillStyle = "#22c55e";
	ctx.strokeStyle = "#14532d";
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.roundRect(-19, -12, 38, 24, 4);
	ctx.fill();
	ctx.stroke();

	ctx.fillStyle = "#4ade80";
	ctx.fillRect(12, -10, 6, 20);

	ctx.fillStyle = "#86efac";
	ctx.strokeStyle = "#14532d";
	ctx.lineWidth = 1.5;
	ctx.fillRect(4, -3, 24, 6);
	ctx.strokeRect(4, -3, 24, 6);

	ctx.fillStyle = "#16a34a";
	ctx.beginPath();
	ctx.arc(-2, 0, 9, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();

	ctx.restore();
}

export function drawHud(ctx, stats, ship) {
	ctx.save();
	ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
	ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.roundRect(14, 14, 250, 112, 8);
	ctx.fill();
	ctx.stroke();

	ctx.fillStyle = "#f8fafc";
	ctx.font =
		"600 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
	ctx.fillText(`steps/s:    ${stats.stepsPerSec} Hz`, 26, 36);
	ctx.fillText(`frames/s:   ${stats.framesPerSec} fps`, 26, 56);
	ctx.fillText(`frame time: ${stats.frameTimeMs.toFixed(2)} ms`, 26, 76);

	ctx.fillStyle = "#94a3b8";
	ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
	ctx.fillText(`pos: (${Math.round(ship.x)}, ${Math.round(ship.y)})`, 26, 98);
	ctx.fillText("WASD / Arrows: drive | Space: boost", 26, 116);
	ctx.restore();
}
