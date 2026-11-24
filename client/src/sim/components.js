import { Vector2 } from "./vector.js";

function normalizeAngle(angle) {
	let a = angle;
	while (a > Math.PI) a -= Math.PI * 2;
	while (a < -Math.PI) a += Math.PI * 2;
	return a;
}

export function createHoming({
	targetKind,
	turnRate = 4.2,
	range = 520,
	accel = 0,
	maxSpeed = 620,
}) {
	return {
		targetKind,
		turnRate,
		range,
		accel,
		maxSpeed,
		targetId: null,
	};
}

export function updateHoming(entity, world, dt) {
	const homing = entity.homing;
	if (!homing) return;

	let nearest = null;
	let bestDist = homing.range;

	for (const candidate of world.ofKind(homing.targetKind)) {
		if (!candidate.alive || candidate.id === entity.id) continue;
		if (typeof candidate.isSpawned === "function" && !candidate.isSpawned()) {
			continue;
		}

		const d = entity.pos.distanceTo(candidate.pos);
		if (d < bestDist) {
			bestDist = d;
			nearest = candidate;
		}
	}

	if (!nearest) {
		homing.targetId = null;
		return;
	}

	homing.targetId = nearest.id;
	const toTarget = nearest.pos.sub(entity.pos);
	const desiredAngle = Math.atan2(toTarget.y, toTarget.x);
	const diff = normalizeAngle(desiredAngle - entity.angle);
	const maxTurn = homing.turnRate * dt;
	const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));

	entity.angle = normalizeAngle(entity.angle + turn);

	const currentSpeed = entity.vel.length();
	const nextSpeed = Math.min(homing.maxSpeed, currentSpeed + homing.accel * dt);
	entity.vel = Vector2.fromAngle(entity.angle, nextSpeed);
}
