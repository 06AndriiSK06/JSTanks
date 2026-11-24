import { wrapArena } from "./arena.js";
import { updateHoming } from "./components.js";
import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";

export class Bullet extends Entity {
	constructor({
		pos,
		vel,
		angle = 0,
		ownerId,
		ttl = 1.5,
		damage = 25,
		radius = 4,
		isMissile = false,
		homing = null,
	}) {
		super({ pos, vel, angle, radius, kind: "bullet" });
		this.ownerId = ownerId;
		this.ttl = ttl;
		this.maxTtl = ttl;
		this.damage = damage;
		this.isMissile = isMissile;
		// Композиція: самонаведення прикріплюється як компонент, без підкласу HomingBullet
		this.homing = homing;
	}

	update(dt, world) {
		this.ttl -= dt;
		if (this.ttl <= 0) {
			world.despawn(this.id);
			return;
		}

		if (this.homing) {
			updateHoming(this, world, dt);
		}

		this.pos = this.pos.add(this.vel.scale(dt));
		wrapArena(this, world.arena);
	}
}

export function createShell({
	pos,
	angle,
	baseVel,
	ownerId,
	isMissile = false,
	homing = null,
}) {
	const speed = isMissile ? 440 : 620;
	const direction = Vector2.fromAngle(angle, speed);
	const vel = baseVel.scale(0.35).add(direction);
	return new Bullet({
		pos,
		vel,
		angle,
		ownerId,
		ttl: isMissile ? 2.4 : 1.4,
		damage: isMissile ? 50 : 25,
		radius: isMissile ? 5.5 : 4,
		isMissile,
		homing,
	});
}
