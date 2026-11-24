import { Asteroid, createRandomAsteroid } from "./asteroid.js";
import { detectCollisions } from "./collision.js";
import { createHoming } from "./components.js";
import { Explosion } from "./explosion.js";
import { Pickup } from "./pickup.js";
import { Vector2 } from "./vector.js";

export class World {
	#entities = new Map();
	#pendingRemoval = new Set();

	constructor({ arena, input }) {
		this.arena = arena;
		this.input = input;
		this.score = 0;
		this.wave = 1;
		this.pickupTimer = 5.0;
	}

	get size() {
		return this.#entities.size;
	}

	get(id) {
		return this.#entities.get(id);
	}

	spawn(entity) {
		this.#entities.set(entity.id, entity);
		return entity;
	}

	despawn(id) {
		const entity = this.#entities.get(id);
		if (entity) {
			entity.alive = false;
			this.#pendingRemoval.add(id);
		}
	}

	sweep() {
		for (const id of this.#pendingRemoval) {
			this.#entities.delete(id);
		}
		this.#pendingRemoval.clear();
	}

	*[Symbol.iterator]() {
		yield* this.#entities.values();
	}

	*ofKind(kind) {
		for (const entity of this) {
			if (entity.kind === kind) {
				yield entity;
			}
		}
	}

	countKind(kind) {
		let count = 0;
		for (const _ of this.ofKind(kind)) {
			count += 1;
		}
		return count;
	}

	findSafeSpawnPos() {
		let candidate = new Vector2(this.arena.width / 2, this.arena.height / 2);
		for (let attempt = 0; attempt < 25; attempt += 1) {
			let safe = true;
			for (const asteroid of this.ofKind("asteroid")) {
				if (candidate.distanceTo(asteroid.pos) < 160) {
					safe = false;
					break;
				}
			}
			if (safe) return candidate;
			candidate = new Vector2(
				80 + Math.random() * Math.max(100, this.arena.width - 160),
				80 + Math.random() * Math.max(100, this.arena.height - 160),
			);
		}
		return candidate;
	}

	spawnWave(count = 5) {
		const ship = this.ofKind("ship").next().value;
		const avoidPos = ship
			? ship.pos
			: new Vector2(this.arena.width / 2, this.arena.height / 2);

		for (let i = 0; i < count; i += 1) {
			// Кожен 4-й астероїд — дрон-переслідувач з композиційним компонентом homing
			const isSeeker = i > 0 && i % 3 === 0;
			const homing = isSeeker
				? createHoming({
						targetKind: "ship",
						turnRate: 1.6,
						range: 480,
						maxSpeed: 120,
					})
				: null;
			this.spawn(createRandomAsteroid(this.arena, avoidPos, homing));
		}
	}

	step(dt) {
		for (const entity of this) {
			entity.savePreviousState();
		}

		for (const entity of this) {
			if (entity.alive) {
				entity.update(dt, this);
			}
		}

		const pairs = detectCollisions(this);
		for (const [a, b] of pairs) {
			if (!a.alive || !b.alive) continue;
			this.#resolvePair(a, b);
		}

		this.pickupTimer -= dt;
		if (this.pickupTimer <= 0) {
			this.pickupTimer = 11.0;
			if (this.countKind("pickup") < 2) {
				const pos = this.findSafeSpawnPos();
				const pickupType = Math.random() > 0.5 ? "shield" : "rapid";
				this.spawn(new Pickup({ pos, pickupType }));
			}
		}

		if (this.countKind("asteroid") === 0) {
			this.wave += 1;
			this.spawnWave(4 + this.wave);
		}

		this.sweep();
	}

	#resolvePair(a, b) {
		const pair = [a, b];
		const bullet = pair.find((e) => e.kind === "bullet");
		const asteroid = pair.find((e) => e.kind === "asteroid");
		const ship = pair.find((e) => e.kind === "ship");
		const pickup = pair.find((e) => e.kind === "pickup");

		// 1. Снаряд влучив у перешкоду/астероїд
		if (bullet && asteroid) {
			this.despawn(bullet.id);
			this.spawn(
				new Explosion({
					pos: bullet.pos,
					color: "#38bdf8",
					count: 8,
					scale: 0.6,
				}),
			);

			const destroyed = asteroid.takeDamage(bullet.damage);
			if (destroyed) {
				this.despawn(asteroid.id);
				this.score += asteroid.size * 100;
				this.spawn(
					new Explosion({
						pos: asteroid.pos,
						color: asteroid.homing ? "#f43f5e" : "#f97316",
						count: 20,
						scale: 1.1,
					}),
				);

				// Ділимо великі уламки на менші
				if (asteroid.size > 1) {
					for (let i = 0; i < 2; i += 1) {
						const offset = Vector2.fromAngle(Math.random() * Math.PI * 2, 14);
						const vel = Vector2.fromAngle(
							Math.random() * Math.PI * 2,
							75 + Math.random() * 55,
						);
						this.spawn(
							new Asteroid({
								pos: asteroid.pos.add(offset),
								vel,
								size: asteroid.size - 1,
							}),
						);
					}
				}
			}
			return;
		}

		// 2. Танк зіткнувся з перешкодою
		if (ship && asteroid) {
			this.despawn(asteroid.id);
			this.spawn(
				new Explosion({
					pos: asteroid.pos,
					color: "#f97316",
					count: 16,
					scale: 0.9,
				}),
			);
			const killed = ship.takeDamage(35);
			if (killed) {
				this.spawn(
					new Explosion({
						pos: ship.pos,
						color: "#ef4444",
						count: 32,
						scale: 1.5,
					}),
				);
			}
			return;
		}

		// 3. Танк підібрав бонус (pickup)
		if (ship && pickup) {
			this.despawn(pickup.id);
			ship.applyPickup(pickup.pickupType);
			this.score += 50;
			this.spawn(
				new Explosion({
					pos: pickup.pos,
					color: pickup.pickupType === "shield" ? "#38bdf8" : "#a855f7",
					count: 14,
					scale: 0.8,
				}),
			);
		}
	}
}
