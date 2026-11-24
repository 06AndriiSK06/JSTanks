import type { PlayerInputCommand } from "../protocol.js";
import type { ArenaBounds, EntityId, OwnerSlot, Seq } from "../types.js";
import { Vector2 } from "./vector.js";

export const ENTITY_KIND = Object.freeze({
	SHIP: 1,
	BULLET: 2,
	ASTEROID: 3,
	PICKUP: 4,
} as const);

export function wrapCoord(val: number, max: number): number {
	if (val < 0) return val + max;
	if (val >= max) return val - max;
	return val;
}

export function normalizeAngle(angle: number): number {
	let a = angle;
	while (a > Math.PI) a -= Math.PI * 2;
	while (a < -Math.PI) a += Math.PI * 2;
	return a;
}

export class SimShip {
	id: EntityId;
	readonly kind = "ship" as const;
	readonly ownerId: string;
	ownerSlot: OwnerSlot;
	name: string;
	pos: Vector2;
	prevPos: Vector2;
	vel: Vector2;
	angle: number;
	prevAngle: number;
	readonly radius = 18;
	hp = 100;
	readonly maxHp = 100;
	alive = true;
	respawnTimer = 0;
	fireCooldown = 0;
	missileCooldown = 0;
	shieldTimer = 0;
	rapidFireTimer = 0;
	thrusting = false;
	score = 0;

	constructor(params: {
		id: EntityId;
		ownerId: string;
		ownerSlot: OwnerSlot;
		name?: string;
		x?: number;
		y?: number;
		angle?: number;
	}) {
		this.id = params.id;
		this.ownerId = params.ownerId;
		this.ownerSlot = params.ownerSlot;
		this.name = params.name ?? "Pilot";
		const x = params.x ?? 400;
		const y = params.y ?? 300;
		const angle = params.angle ?? 0;
		this.pos = new Vector2(x, y);
		this.prevPos = new Vector2(x, y);
		this.vel = new Vector2(0, 0);
		this.angle = angle;
		this.prevAngle = angle;
	}

	isSpawned(): boolean {
		return this.respawnTimer <= 0;
	}

	savePreviousState(): void {
		this.prevPos = this.pos.clone();
		this.prevAngle = this.angle;
	}

	applyInput(
		input: PlayerInputCommand | null,
		dt: number,
		arena: ArenaBounds,
	): { isMissile: boolean } | null {
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

		const turnDir = input ? input.turn : 0;
		const thrustDir = input ? input.thrust : 0;

		const turnRate = 3.2;
		this.angle = normalizeAngle(this.angle + turnDir * turnRate * dt);

		const accel = thrustDir >= 0 ? 340 : 210;
		this.thrusting = thrustDir !== 0;
		if (thrustDir !== 0) {
			const forward = Vector2.fromAngle(this.angle, thrustDir * accel * dt);
			this.vel = this.vel.add(forward);
		}

		this.vel = this.vel.scale(0.18 ** dt);
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

	takeDamage(amount: number): boolean {
		if (!this.isSpawned() || this.shieldTimer > 0) return false;
		this.hp = Math.max(0, this.hp - amount);
		if (this.hp === 0) {
			this.respawnTimer = 2.5;
			this.vel = new Vector2(0, 0);
			return true;
		}
		return false;
	}

	applyPickup(type: "shield" | "rapid"): void {
		if (type === "shield") {
			this.hp = Math.min(this.maxHp, this.hp + 35);
			this.shieldTimer = 6.0;
		} else {
			this.rapidFireTimer = 7.0;
		}
	}
}

export class SimBullet {
	readonly id: EntityId;
	readonly kind = "bullet" as const;
	readonly ownerId: string;
	readonly ownerSlot: OwnerSlot;
	pos: Vector2;
	prevPos: Vector2;
	vel: Vector2;
	angle: number;
	prevAngle: number;
	readonly isMissile: boolean;
	readonly clientSeq: Seq;
	readonly radius: number;
	readonly damage: number;
	ttl: number;
	alive = true;

	constructor(params: {
		id: EntityId;
		ownerId: string;
		ownerSlot: OwnerSlot;
		x: number;
		y: number;
		vx: number;
		vy: number;
		angle: number;
		isMissile?: boolean;
		clientSeq?: Seq;
	}) {
		this.id = params.id;
		this.ownerId = params.ownerId;
		this.ownerSlot = params.ownerSlot;
		this.pos = new Vector2(params.x, params.y);
		this.prevPos = new Vector2(params.x, params.y);
		this.vel = new Vector2(params.vx, params.vy);
		this.angle = params.angle;
		this.prevAngle = params.angle;
		this.isMissile = params.isMissile ?? false;
		this.clientSeq = params.clientSeq ?? (0 as Seq);
		this.radius = this.isMissile ? 7 : 4;
		this.damage = this.isMissile ? 45 : 25;
		this.ttl = this.isMissile ? 2.4 : 1.35;
	}

	savePreviousState(): void {
		this.prevPos = this.pos.clone();
		this.prevAngle = this.angle;
	}

	step(dt: number, arena: ArenaBounds, ships: Iterable<SimShip>): void {
		this.ttl -= dt;
		if (this.ttl <= 0) {
			this.alive = false;
			return;
		}

		if (this.isMissile) {
			let nearest: SimShip | null = null;
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
	readonly id: EntityId;
	readonly kind = "asteroid" as const;
	pos: Vector2;
	prevPos: Vector2;
	vel: Vector2;
	angle: number;
	prevAngle: number;
	readonly spin: number;
	readonly size: 1 | 2;
	readonly isSeeker: boolean;
	readonly radius: number;
	hp: number;
	alive = true;

	constructor(params: {
		id: EntityId;
		x: number;
		y: number;
		vx: number;
		vy: number;
		angle?: number;
		spin?: number;
		size?: 1 | 2;
		isSeeker?: boolean;
	}) {
		this.id = params.id;
		this.pos = new Vector2(params.x, params.y);
		this.prevPos = new Vector2(params.x, params.y);
		this.vel = new Vector2(params.vx, params.vy);
		this.angle = params.angle ?? 0;
		this.prevAngle = this.angle;
		this.spin = params.spin ?? 0.6;
		this.size = params.size ?? 2;
		this.isSeeker = params.isSeeker ?? false;
		this.radius = this.size === 2 ? 26 : 15;
		this.hp = this.size === 2 ? 50 : 25;
	}

	savePreviousState(): void {
		this.prevPos = this.pos.clone();
		this.prevAngle = this.angle;
	}

	step(dt: number, arena: ArenaBounds, ships: Iterable<SimShip>): void {
		this.angle = normalizeAngle(this.angle + this.spin * dt);
		if (this.isSeeker) {
			let target: SimShip | null = null;
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
	readonly id: EntityId;
	readonly kind = "pickup" as const;
	pos: Vector2;
	prevPos: Vector2;
	readonly pickupType: "shield" | "rapid";
	readonly radius = 14;
	alive = true;

	constructor(params: {
		id: EntityId;
		x: number;
		y: number;
		pickupType?: "shield" | "rapid";
	}) {
		this.id = params.id;
		this.pos = new Vector2(params.x, params.y);
		this.prevPos = new Vector2(params.x, params.y);
		this.pickupType = params.pickupType ?? "shield";
	}

	savePreviousState(): void {
		this.prevPos = this.pos.clone();
	}
}
