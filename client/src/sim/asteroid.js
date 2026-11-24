import { wrapArena } from "./arena.js";
import { updateHoming } from "./components.js";
import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";

export class Asteroid extends Entity {
	constructor({ pos, vel, size = 3, homing = null }) {
		const radiusMap = { 3: 34, 2: 22, 1: 13 };
		const hpMap = { 3: 75, 2: 50, 1: 25 };
		const radius = radiusMap[size] ?? 22;

		super({
			pos,
			vel,
			angle: Math.random() * Math.PI * 2,
			radius,
			kind: "asteroid",
		});

		this.size = size;
		this.hp = hpMap[size] ?? 25;
		this.maxHp = this.hp;
		this.spin = (Math.random() - 0.5) * 1.8;
		// Композиція: дрон-астероїд може отримати homing без окремого класу HomingAsteroid
		this.homing = homing;
		this.vertices = Array.from({ length: 9 }, (_, i) => {
			const a = (i / 9) * Math.PI * 2;
			const jitter = 0.78 + Math.random() * 0.36;
			return { angle: a, dist: radius * jitter };
		});
	}

	takeDamage(amount) {
		this.hp -= amount;
		return this.hp <= 0;
	}

	update(dt, world) {
		if (this.homing) {
			updateHoming(this, world, dt);
		} else {
			this.angle += this.spin * dt;
		}

		this.pos = this.pos.add(this.vel.scale(dt));
		wrapArena(this, world.arena);
	}
}

export function createRandomAsteroid(arena, avoidPos, homing = null) {
	let pos = new Vector2(
		Math.random() * arena.width,
		Math.random() * arena.height,
	);
	for (let i = 0; i < 15; i += 1) {
		if (pos.distanceTo(avoidPos) > 180) break;
		pos = new Vector2(
			Math.random() * arena.width,
			Math.random() * arena.height,
		);
	}

	const speed = homing ? 95 : 45 + Math.random() * 65;
	const vel = Vector2.fromAngle(Math.random() * Math.PI * 2, speed);
	const size = homing ? 2 : 3;
	return new Asteroid({ pos, vel, size, homing });
}
