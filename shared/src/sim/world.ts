import type { PlayerInputCommand } from "../protocol.js";
import {
	type ArenaBounds,
	asEntityId,
	asOwnerSlot,
	asSeq,
	asTick,
	type EntityId,
	type OwnerSlot,
	type Seq,
	type SimGameEvent,
	type SnapshotEntity,
	type Tick,
	type WorldSnapshot,
} from "../types.js";
import {
	ENTITY_KIND,
	SimAsteroid,
	SimBullet,
	SimPickup,
	SimShip,
} from "./entities.js";
import { ObjectPool } from "./pool.js";
import { createRng, type RngFn } from "./rng.js";
import { SpatialHashGrid } from "./spatialHash.js";
import { Vector2 } from "./vector.js";

export class SharedWorld {
	readonly arena: ArenaBounds;
	readonly seed: number;
	private readonly rng: RngFn;
	readonly initialAsteroids: number;
	tick: Tick = asTick(0);
	private nextEntityId = 1;
	readonly ships = new Map<string, SimShip>();
	readonly bullets = new Map<EntityId, SimBullet>();
	readonly asteroids = new Map<EntityId, SimAsteroid>();
	readonly pickups = new Map<EntityId, SimPickup>();
	private pickupTimer = 6.0;
	readonly events: SimGameEvent[] = [];

	readonly bulletPool = new ObjectPool<SimBullet>(
		() =>
			new SimBullet({
				id: asEntityId(0),
				ownerId: "",
				ownerSlot: asOwnerSlot(0),
				x: 0,
				y: 0,
				vx: 0,
				vy: 0,
				angle: 0,
			}),
		() => {},
		64,
	);

	private readonly asteroidGrid = new SpatialHashGrid<SimAsteroid>(96);
	private readonly shipGrid = new SpatialHashGrid<SimShip>(96);
	private readonly queryAsteroidsBuf: SimAsteroid[] = [];
	private readonly queryShipsBuf: SimShip[] = [];

	constructor(
		params: {
			width?: number;
			height?: number;
			seed?: number;
			initialAsteroids?: number;
		} = {},
	) {
		this.arena = { width: params.width ?? 1200, height: params.height ?? 760 };
		this.seed = (params.seed ?? 42) >>> 0;
		this.rng = createRng(this.seed);
		this.initialAsteroids = params.initialAsteroids ?? 5;
	}

	allocId(): EntityId {
		const id = asEntityId(this.nextEntityId);
		this.nextEntityId = (this.nextEntityId % 65000) + 1;
		return id;
	}

	spawnShip(params: {
		ownerId: string;
		ownerSlot: OwnerSlot;
		name: string;
	}): SimShip {
		const existing = this.ships.get(params.ownerId);
		if (existing) {
			return existing;
		}
		const id = this.allocId();
		const x = 140 + this.rng() * (this.arena.width - 280);
		const y = 140 + this.rng() * (this.arena.height - 280);
		const angle = (this.rng() - 0.5) * Math.PI * 2;
		const ship = new SimShip({
			id,
			ownerId: params.ownerId,
			ownerSlot: params.ownerSlot,
			name: params.name,
			x,
			y,
			angle,
		});
		ship.shieldTimer = 2.0;
		this.ships.set(params.ownerId, ship);
		return ship;
	}

	removeShip(ownerId: string): void {
		this.ships.delete(ownerId);
	}

	spawnWave(count = this.initialAsteroids): void {
		for (let i = 0; i < count; i += 1) {
			const x = 60 + this.rng() * (this.arena.width - 120);
			const y = 60 + this.rng() * (this.arena.height - 120);
			const angle = this.rng() * Math.PI * 2;
			const speed = 55 + this.rng() * 55;
			const isSeeker = i % 3 === 2;
			const ast = new SimAsteroid({
				id: this.allocId(),
				x,
				y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				angle,
				spin: (this.rng() - 0.5) * 1.6,
				size: 2,
				isSeeker,
			});
			this.asteroids.set(ast.id, ast);
		}
	}

	spawnBulletFromShip(
		ship: SimShip,
		isMissile: boolean,
		clientSeq: Seq,
	): SimBullet {
		const muzzle = Vector2.fromAngle(ship.angle, ship.radius + 10);
		const speed = isMissile ? 340 : 520;
		const vel = Vector2.fromAngle(ship.angle, speed).add(ship.vel.scale(0.25));
		const bullet = this.bulletPool.acquire();
		bullet.reset({
			id: this.allocId(),
			ownerId: ship.ownerId,
			ownerSlot: ship.ownerSlot,
			x: ship.pos.x + muzzle.x,
			y: ship.pos.y + muzzle.y,
			vx: vel.x,
			vy: vel.y,
			angle: ship.angle,
			isMissile,
			clientSeq,
		});
		this.bullets.set(bullet.id, bullet);
		this.events.push({ type: "fired", ownerId: ship.ownerId, isMissile });
		return bullet;
	}

	step(
		dt: number,
		inputsByOwner: ReadonlyMap<string, PlayerInputCommand> = new Map(),
	): void {
		this.tick = asTick(this.tick + 1);
		this.events.length = 0;

		for (const ship of this.ships.values()) {
			ship.savePreviousState();
			const input = inputsByOwner.get(ship.ownerId) ?? null;
			const shot = ship.applyInput(input, dt, this.arena);
			if (shot) {
				this.spawnBulletFromShip(
					ship,
					shot.isMissile,
					input ? input.seq : asSeq(0),
				);
			}
		}

		for (const bullet of this.bullets.values()) {
			bullet.savePreviousState();
			bullet.step(dt, this.arena, this.ships.values());
		}

		for (const ast of this.asteroids.values()) {
			ast.savePreviousState();
			ast.step(dt, this.arena, this.ships.values());
		}

		this.resolveCollisionsSpatial();

		for (const [id, b] of this.bullets) {
			if (!b.alive) {
				this.bullets.delete(id);
				this.bulletPool.release(b);
			}
		}
		for (const [id, a] of this.asteroids) {
			if (!a.alive) this.asteroids.delete(id);
		}
		for (const [id, p] of this.pickups) {
			if (!p.alive) this.pickups.delete(id);
		}

		this.pickupTimer -= dt;
		if (this.pickupTimer <= 0) {
			this.pickupTimer = 10.0;
			if (this.pickups.size < 2) {
				const pickup = new SimPickup({
					id: this.allocId(),
					x: 100 + this.rng() * (this.arena.width - 200),
					y: 100 + this.rng() * (this.arena.height - 200),
					pickupType: this.rng() > 0.5 ? "shield" : "rapid",
				});
				this.pickups.set(pickup.id, pickup);
			}
		}

		if (this.asteroids.size === 0) {
			this.spawnWave(this.initialAsteroids);
		}
	}

	private resolveCollisionsSpatial(): void {
		this.asteroidGrid.clear();
		for (const ast of this.asteroids.values()) {
			if (ast.alive) this.asteroidGrid.insert(ast);
		}

		this.shipGrid.clear();
		for (const ship of this.ships.values()) {
			if (ship.isSpawned()) this.shipGrid.insert(ship);
		}

		for (const bullet of this.bullets.values()) {
			if (!bullet.alive) continue;

			const nearAsteroids = this.asteroidGrid.queryNear(
				bullet.pos.x,
				bullet.pos.y,
				bullet.radius + 30,
				this.queryAsteroidsBuf,
			);
			for (const ast of nearAsteroids) {
				if (!ast.alive) continue;
				if (bullet.pos.distanceTo(ast.pos) <= bullet.radius + ast.radius) {
					bullet.alive = false;
					ast.hp -= bullet.damage;
					if (ast.hp <= 0) {
						ast.alive = false;
						const shooter = this.ships.get(bullet.ownerId);
						if (shooter) shooter.score += ast.size * 100;
						this.events.push({
							type: "exploded",
							kind: "asteroid",
							x: ast.pos.x,
							y: ast.pos.y,
						});

						if (ast.size > 1) {
							for (let i = 0; i < 2; i += 1) {
								const ang = this.rng() * Math.PI * 2;
								const spd = 80 + this.rng() * 50;
								const child = new SimAsteroid({
									id: this.allocId(),
									x: ast.pos.x + Math.cos(ang) * 12,
									y: ast.pos.y + Math.sin(ang) * 12,
									vx: Math.cos(ang) * spd,
									vy: Math.sin(ang) * spd,
									angle: ang,
									size: 1,
									isSeeker: false,
								});
								this.asteroids.set(child.id, child);
							}
						}
					} else {
						this.events.push({ type: "hit", kind: "asteroid" });
					}
					break;
				}
			}

			if (!bullet.alive) continue;

			const nearShips = this.shipGrid.queryNear(
				bullet.pos.x,
				bullet.pos.y,
				bullet.radius + 24,
				this.queryShipsBuf,
			);
			for (const ship of nearShips) {
				if (!ship.isSpawned() || ship.ownerId === bullet.ownerId) continue;
				if (bullet.pos.distanceTo(ship.pos) <= bullet.radius + ship.radius) {
					bullet.alive = false;
					const killed = ship.takeDamage(bullet.damage);
					const shooter = this.ships.get(bullet.ownerId);
					if (killed) {
						if (shooter) shooter.score += 300;
						this.events.push({
							type: "exploded",
							kind: "ship",
							x: ship.pos.x,
							y: ship.pos.y,
						});
					} else {
						this.events.push({ type: "hit", kind: "ship" });
					}
					break;
				}
			}
		}

		for (const ship of this.ships.values()) {
			if (!ship.isSpawned()) continue;

			const nearAsteroids = this.asteroidGrid.queryNear(
				ship.pos.x,
				ship.pos.y,
				ship.radius + 30,
				this.queryAsteroidsBuf,
			);
			for (const ast of nearAsteroids) {
				if (!ast.alive) continue;
				if (ship.pos.distanceTo(ast.pos) <= ship.radius + ast.radius) {
					ast.alive = false;
					const killed = ship.takeDamage(30);
					this.events.push({
						type: killed ? "exploded" : "hit",
						kind: "ship",
						x: ship.pos.x,
						y: ship.pos.y,
					});
				}
			}

			for (const pickup of this.pickups.values()) {
				if (!pickup.alive) continue;
				if (ship.pos.distanceTo(pickup.pos) <= ship.radius + pickup.radius) {
					pickup.alive = false;
					ship.applyPickup(pickup.pickupType);
					ship.score += 50;
					this.events.push({
						type: "pickup",
						ownerId: ship.ownerId,
						pickupType: pickup.pickupType,
					});
				}
			}
		}
	}

	toSnapshot(lastProcessedSeq: Seq): WorldSnapshot {
		const entities: SnapshotEntity[] = [];

		for (const s of this.ships.values()) {
			let flags = 0;
			if (s.isSpawned()) flags |= 1;
			if (s.shieldTimer > 0) flags |= 2;
			if (s.rapidFireTimer > 0) flags |= 4;
			if (s.thrusting) flags |= 8;

			entities.push({
				id: s.id,
				kindCode: ENTITY_KIND.SHIP,
				kind: "ship",
				ownerSlot: s.ownerSlot,
				ownerId: s.ownerId,
				name: s.name,
				x: s.pos.x,
				y: s.pos.y,
				vx: s.vel.x,
				vy: s.vel.y,
				angle: s.angle,
				hp: s.hp,
				score: s.score,
				flags,
			});
		}

		for (const b of this.bullets.values()) {
			entities.push({
				id: b.id,
				kindCode: ENTITY_KIND.BULLET,
				kind: "bullet",
				ownerSlot: b.ownerSlot,
				ownerId: b.ownerId,
				x: b.pos.x,
				y: b.pos.y,
				vx: b.vel.x,
				vy: b.vel.y,
				angle: b.angle,
				hp: 1,
				score: 0,
				flags: b.isMissile ? 1 : 0,
			});
		}

		for (const a of this.asteroids.values()) {
			let flags = a.size === 2 ? 1 : 0;
			if (a.isSeeker) flags |= 2;
			entities.push({
				id: a.id,
				kindCode: ENTITY_KIND.ASTEROID,
				kind: "asteroid",
				ownerSlot: asOwnerSlot(0),
				x: a.pos.x,
				y: a.pos.y,
				vx: a.vel.x,
				vy: a.vel.y,
				angle: a.angle,
				hp: a.hp,
				score: 0,
				flags,
			});
		}

		for (const p of this.pickups.values()) {
			entities.push({
				id: p.id,
				kindCode: ENTITY_KIND.PICKUP,
				kind: "pickup",
				ownerSlot: asOwnerSlot(0),
				x: p.pos.x,
				y: p.pos.y,
				vx: 0,
				vy: 0,
				angle: 0,
				hp: 1,
				score: 0,
				flags: p.pickupType === "shield" ? 1 : 0,
			});
		}

		return {
			type: "snapshot",
			tick: this.tick,
			lastProcessedSeq,
			entities,
		};
	}

	stateHash(): string {
		let hash = 2166136261 >>> 0;
		const mix = (n: number): void => {
			const v = Math.round(n * 100);
			hash ^= v & 0xffff;
			hash = Math.imul(hash, 16777619) >>> 0;
		};
		mix(this.tick);
		for (const s of this.ships.values()) {
			mix(s.pos.x);
			mix(s.pos.y);
			mix(s.angle * 100);
			mix(s.hp);
		}
		for (const a of this.asteroids.values()) {
			mix(a.pos.x);
			mix(a.pos.y);
		}
		return hash.toString(16).padStart(8, "0");
	}
}
