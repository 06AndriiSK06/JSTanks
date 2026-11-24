import { Vector2 } from "./vector.js";

export const ENTITY_KIND = Object.freeze({
	SHIP: 1,
	BULLET: 2,
	ASTEROID: 3,
	PICKUP: 4,
});

export const KIND_FROM_CODE = Object.freeze({
	1: "ship",
	2: "bullet",
	3: "asteroid",
	4: "pickup",
});

export function wrapCoord(val, max) {
	if (val < 0) return val + max;
	if (val >= max) return val - max;
	return val;
}

export function normalizeAngle(angle) {
	let a = angle;
	while (a > Math.PI) a -= Math.PI * 2;
	while (a < -Math.PI) a += Math.PI * 2;
	return a;
}

export class SimShip {
	constructor({ id, ownerId, name = "Pilot", x = 400, y = 300, angle = 0 }) {
		this.id = id;
		this.kind = "ship";
		this.ownerId = ownerId;
		this.name = name;
		this.pos = new Vector2(x, y);
		this.prevPos = new Vector2(x, y);
		this.vel = new Vector2(0, 0);
		this.angle = angle;
		this.prevAngle = angle;
		this.radius = 18;
		this.hp = 100;
		this.maxHp = 100;
		this.alive = true;
		this.respawnTimer = 0;
		this.fireCooldown = 0;
		this.missileCooldown = 0;
		this.shieldTimer = 0;
		this.rapidFireTimer = 0;
		this.thrusting = false;
		this.score = 0;
	}

	isSpawned() {
		return this.respawnTimer <= 0;
	}

	savePreviousState() {
		this.prevPos = this.pos.clone();
		this.prevAngle = this.angle;
	}

	applyInput(input, dt, arena) {
		if (this.fireCooldown > 0)
			this.fireCooldown = Math.max(0, this.fireCooldown - dt);
		if (this.missileCooldown > 0)
			this.missileCooldown = Math.max(0, this.missileCooldown - dt);
		if (this.shieldTimer > 0)
			this.shieldTimer = Math.max(0, this.shieldTimer - dt);
		if (this.rapidFireTimer > 0)
			this.rapidFireTimer = Math.max(0, this.rapidFireTimer - dt);

		if (!this.isSpawned()) {
			this.respawnTimer = Math.max(0, this.respawnTimer - dt);
			if (this.respawnTimer === 0) {
				this.hp = this.maxHp;
				this.vel = new Vector2(0, 0);
				this.shieldTimer = 2.0;
			}
			return null;
		}

		const turnDir = Math.max(-1, Math.min(1, Number(input?.turn) || 0));
		const thrustDir = Math.max(-1, Math.min(1, Number(input?.thrust) || 0));

		const turnRate = 3.2;
		this.angle = normalizeAngle(this.angle + turnDir * turnRate * dt);

		const accel = thrustDir >= 0 ? 340 : 210;
		this.thrusting = thrustDir !== 0;
		if (thrustDir !== 0) {
			const forward = Vector2.fromAngle(this.angle, thrustDir * accel * dt);
			this.vel = this.vel.add(forward);
		}

		// Демпфування тертям
		this.vel = this.vel.scale(Math.pow(0.18, dt));
		const maxSpeed = 290;
		if (this.vel.length() > maxSpeed) {
			this.vel = this.vel.normalize().scale(maxSpeed);
		}

		this.pos = new Vector2(
			wrapCoord(this.pos.x + this.vel.x * dt, arena.width),
			wrapCoord(this.pos.y + this.vel.y * dt, arena.height),
		);

		const cdScale = this.rapidFireTimer > 0 ? 0.45 : 1;
		if (input?.fire && this.fireCooldown <= 0) {
			this.fireCooldown = 0.28 * cdScale;
			return { isMissile: false };
		}
		if (input?.missile && this.missileCooldown <= 0) {
			this.missileCooldown = 1.4 * cdScale;
			return { isMissile: true };
		}
		return null;
	}

	takeDamage(amount) {
		if (!this.isSpawned() || this.shieldTimer > 0) return false;
		this.hp = Math.max(0, this.hp - amount);
		if (this.hp === 0) {
			this.respawnTimer = 2.5;
			this.vel = new Vector2(0, 0);
			return true;
		}
		return false;
	}

	applyPickup(type) {
		if (type === "shield") {
			this.hp = Math.min(this.maxHp, this.hp + 35);
			this.shieldTimer = 6.0;
		} else {
			this.rapidFireTimer = 7.0;
		}
	}
}

export class SimBullet {
	constructor({
		id,
		ownerId,
		x,
		y,
		vx,
		vy,
		angle,
		isMissile = false,
		clientSeq = 0,
	}) {
		this.id = id;
		this.kind = "bullet";
		this.ownerId = ownerId;
		this.pos = new Vector2(x, y);
		this.prevPos = new Vector2(x, y);
		this.vel = new Vector2(vx, vy);
		this.angle = angle;
		this.prevAngle = angle;
		this.isMissile = isMissile;
		this.clientSeq = clientSeq;
		this.radius = isMissile ? 7 : 4;
		this.damage = isMissile ? 45 : 25;
		this.ttl = isMissile ? 2.4 : 1.35;
		this.alive = true;
	}

	savePreviousState() {
		this.prevPos = this.pos.clone();
		this.prevAngle = this.angle;
	}

	step(dt, arena, ships) {
		this.ttl -= dt;
		if (this.ttl <= 0) {
			this.alive = false;
			return;
		}

		if (this.isMissile && ships) {
			let nearest = null;
			let bestDist = 420;
			for (const s of ships) {
				if (!s.isSpawned() || s.ownerId === this.ownerId) continue;
				const d = this.pos.distanceTo(s.pos);
				if (d < bestDist) {
					bestDist = d;
					nearest = s;
				}
			}
			if (nearest) {
				const desired = Math.atan2(
					nearest.pos.y - this.pos.y,
					nearest.pos.x - this.pos.x,
				);
				const diff = normalizeAngle(desired - this.angle);
				const maxTurn = 2.8 * dt;
				this.angle = normalizeAngle(
					this.angle + Math.max(-maxTurn, Math.min(maxTurn, diff)),
				);
				const speed = this.vel.length();
				this.vel = Vector2.fromAngle(this.angle, speed);
			}
		}

		this.pos = new Vector2(
			wrapCoord(this.pos.x + this.vel.x * dt, arena.width),
			wrapCoord(this.pos.y + this.vel.y * dt, arena.height),
		);
	}
}

export class SimAsteroid {
	constructor({
		id,
		x,
		y,
		vx,
		vy,
		angle = 0,
		spin = 0.6,
		size = 2,
		isSeeker = false,
	}) {
		this.id = id;
		this.kind = "asteroid";
		this.pos = new Vector2(x, y);
		this.prevPos = new Vector2(x, y);
		this.vel = new Vector2(vx, vy);
		this.angle = angle;
		this.prevAngle = angle;
		this.spin = spin;
		this.size = size;
		this.isSeeker = isSeeker;
		this.radius = size === 2 ? 26 : 15;
		this.hp = size === 2 ? 50 : 25;
		this.alive = true;
	}

	savePreviousState() {
		this.prevPos = this.pos.clone();
		this.prevAngle = this.angle;
	}

	step(dt, arena, ships) {
		this.angle = normalizeAngle(this.angle + this.spin * dt);
		if (this.isSeeker && ships) {
			let target = null;
			let best = 460;
			for (const s of ships) {
				if (!s.isSpawned()) continue;
				const d = this.pos.distanceTo(s.pos);
				if (d < best) {
					best = d;
					target = s;
				}
			}
			if (target) {
				const dir = target.pos.sub(this.pos).normalize().scale(105);
				this.vel = this.vel.scale(0.95).add(dir.scale(0.05));
			}
		}
		this.pos = new Vector2(
			wrapCoord(this.pos.x + this.vel.x * dt, arena.width),
			wrapCoord(this.pos.y + this.vel.y * dt, arena.height),
		);
	}
}

export class SimPickup {
	constructor({ id, x, y, pickupType = "shield" }) {
		this.id = id;
		this.kind = "pickup";
		this.pos = new Vector2(x, y);
		this.prevPos = new Vector2(x, y);
		this.vel = new Vector2(0, 0);
		this.angle = 0;
		this.prevAngle = 0;
		this.pickupType = pickupType;
		this.radius = 14;
		this.alive = true;
	}

	savePreviousState() {
		this.prevPos = this.pos.clone();
	}
}
