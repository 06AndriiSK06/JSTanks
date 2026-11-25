import { describe, expect, it } from "vitest";
import {
	asEntityId,
	asOwnerSlot,
	asSeq,
	BIN_MSG_INPUT,
	BIN_MSG_SNAPSHOT,
	BIN_VERSION,
	BinarySnapshotCodec,
	createRng,
	decodeInputBinary,
	decodeSnapshotBinary,
	encodeInputBinary,
	JsonSnapshotCodec,
	normalizeAngle,
	ObjectPool,
	parseClientMessage,
	SharedWorld,
	SimAsteroid,
	SimPickup,
	SimShip,
	SpatialHashGrid,
	toPlayerInputCommand,
	Vector2,
	wrapCoord,
} from "../src/index.js";
describe("Vector2 math & immutability", () => {
	it("creates zero vector by default", () => {
		const v = new Vector2();
		expect(v.x).toBe(0);
		expect(v.y).toBe(0);
	});
	it("adds vectors without mutating operands", () => {
		const a = new Vector2(3, 4);
		const b = new Vector2(-1, 2);
		const c = a.add(b);
		expect(c.x).toBe(2);
		expect(c.y).toBe(6);
		expect(a.x).toBe(3);
	});
	it("subtracts vectors accurately", () => {
		const c = new Vector2(10, 5).sub(new Vector2(3, 8));
		expect(c.x).toBe(7);
		expect(c.y).toBe(-3);
	});
	it("scales vectors by scalar", () => {
		const v = new Vector2(2, -5).scale(3);
		expect(v.x).toBe(6);
		expect(v.y).toBe(-15);
	});
	it("computes length and distanceTo", () => {
		const a = new Vector2(0, 0);
		const b = new Vector2(3, 4);
		expect(b.length()).toBe(5);
		expect(a.distanceTo(b)).toBe(5);
	});
	it("normalizes non-zero vector and handles zero vector safely", () => {
		const n = new Vector2(0, 5).normalize();
		expect(n.x).toBe(0);
		expect(n.y).toBe(1);
		const z = new Vector2(0, 0).normalize();
		expect(z.length()).toBe(0);
	});
	it("constructs unit/scaled vector from angle", () => {
		const v = Vector2.fromAngle(Math.PI / 2, 10);
		expect(v.x).toBeCloseTo(0, 5);
		expect(v.y).toBeCloseTo(10, 5);
	});
	it("clones vector independently", () => {
		const a = new Vector2(7, 9);
		const b = a.clone();
		expect(b).not.toBe(a);
		expect(b.x).toBe(7);
		expect(b.y).toBe(9);
	});
});
describe("Coordinate wrapping & angle normalization", () => {
	it("wraps negative and overflowing coordinates", () => {
		expect(wrapCoord(-5, 100)).toBe(95);
		expect(wrapCoord(105, 100)).toBe(5);
		expect(wrapCoord(50, 100)).toBe(50);
	});
	it("normalizes angles into [-PI, PI]", () => {
		expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 5);
		expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 5);
	});
	it("createRng generates deterministic sequences per seed", () => {
		const r1 = createRng(12345);
		const r2 = createRng(12345);
		const r3 = createRng(54321);
		expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
		expect(r1()).not.toBe(r3());
	});
});
describe("SimShip integration, weapons, damage & pickups", () => {
	const arena = { width: 1200, height: 760 };
	it("accelerates forward and clamps speed to maxSpeed", () => {
		const ship = new SimShip({
			id: asEntityId(1),
			ownerId: "p1",
			ownerSlot: asOwnerSlot(1),
			x: 200,
			y: 200,
			angle: 0,
		});
		const cmd = {
			seq: asSeq(1),
			thrust: 1,
			turn: 0,
			fire: false,
			missile: false,
			clientTick: 1,
		};
		for (let i = 0; i < 60; i += 1) {
			ship.applyInput(cmd, 1 / 30, arena);
		}
		expect(ship.vel.length()).toBeLessThanOrEqual(290.001);
		expect(ship.pos.x).not.toBe(200);
	});
	it("rotates ship on turn input and fires primary/missile with cooldowns", () => {
		const ship = new SimShip({
			id: asEntityId(1),
			ownerId: "p1",
			ownerSlot: asOwnerSlot(1),
			x: 300,
			y: 300,
			angle: 0,
		});
		const fireCmd = {
			seq: asSeq(1),
			thrust: 0,
			turn: 1,
			fire: true,
			missile: false,
			clientTick: 1,
		};
		const shot1 = ship.applyInput(fireCmd, 1 / 30, arena);
		expect(shot1).toEqual({ isMissile: false });
		expect(ship.angle).toBeGreaterThan(0);
		// Другий постріл одразу на наступному тіку блокується cooldown
		expect(ship.applyInput(fireCmd, 1 / 30, arena)).toBeNull();
		const missileCmd = {
			seq: asSeq(2),
			thrust: 0,
			turn: 0,
			fire: false,
			missile: true,
			clientTick: 2,
		};
		expect(ship.applyInput(missileCmd, 1 / 30, arena)).toEqual({
			isMissile: true,
		});
	});
	it("ignores damage while shield is active and respawns after lethal hit", () => {
		const ship = new SimShip({
			id: asEntityId(1),
			ownerId: "p1",
			ownerSlot: asOwnerSlot(1),
		});
		ship.shieldTimer = 2.0;
		expect(ship.takeDamage(50)).toBe(false);
		expect(ship.hp).toBe(100);
		ship.shieldTimer = 0;
		expect(ship.takeDamage(40)).toBe(false);
		expect(ship.hp).toBe(60);
		expect(ship.takeDamage(80)).toBe(true);
		expect(ship.hp).toBe(0);
		expect(ship.isSpawned()).toBe(false);
		// Очікування респавну 2.5 с
		for (let i = 0; i < 80; i += 1) {
			ship.applyInput(null, 1 / 30, arena);
		}
		expect(ship.isSpawned()).toBe(true);
		expect(ship.hp).toBe(100);
	});
	it("applies shield and rapid pickups properly", () => {
		const ship = new SimShip({
			id: asEntityId(1),
			ownerId: "p1",
			ownerSlot: asOwnerSlot(1),
		});
		ship.hp = 50;
		ship.applyPickup("shield");
		expect(ship.hp).toBe(85);
		expect(ship.shieldTimer).toBe(6);
		ship.applyPickup("rapid");
		expect(ship.rapidFireTimer).toBe(7);
	});
});
describe("ObjectPool & SpatialHashGrid", () => {
	it("recycles released items without increasing totalCreated", () => {
		const pool = new ObjectPool(
			() => ({ value: 0 }),
			(item) => {
				item.value = 0;
			},
			2,
		);
		expect(pool.totalCreated).toBe(2);
		const a = pool.acquire();
		const b = pool.acquire();
		a.value = 42;
		pool.release(a);
		const c = pool.acquire();
		expect(c).toBe(a);
		expect(c.value).toBe(0);
		expect(pool.totalCreated).toBe(2);
		pool.release(b);
		pool.release(c);
		expect(pool.availableCount).toBe(2);
	});
	it("SpatialHashGrid finds nearby bodies and ignores distant ones", () => {
		const grid = new SpatialHashGrid(96);
		const nearAst = new SimAsteroid({
			id: asEntityId(1),
			x: 100,
			y: 100,
			vx: 0,
			vy: 0,
			size: 2,
		});
		const farAst = new SimAsteroid({
			id: asEntityId(2),
			x: 950,
			y: 650,
			vx: 0,
			vy: 0,
			size: 2,
		});
		grid.insert(nearAst);
		grid.insert(farAst);
		const found = grid.queryNear(110, 110, 30);
		expect(found).toContain(nearAst);
		expect(found).not.toContain(farAst);
	});
});
describe("SharedWorld collisions & determinism", () => {
	it("detects touching/overlapping bullet-asteroid collision and splits large asteroid", () => {
		const world = new SharedWorld({
			width: 1200,
			height: 760,
			seed: 10,
			initialAsteroids: 0,
		});
		const ship = world.spawnShip({
			ownerId: "p1",
			ownerSlot: asOwnerSlot(1),
			name: "Andrii",
		});
		ship.pos = new Vector2(200, 200);
		ship.angle = 0;
		const ast = new SimAsteroid({
			id: world.allocId(),
			x: 235,
			y: 200,
			vx: 0,
			vy: 0,
			size: 2,
		});
		ast.hp = 25;
		world.asteroids.set(ast.id, ast);
		const inputs = new Map([
			[
				"p1",
				{
					seq: asSeq(1),
					thrust: 0,
					turn: 0,
					fire: true,
					missile: false,
					clientTick: 1,
				},
			],
		]);
		world.step(1 / 30, inputs);
		expect(ast.alive).toBe(false);
		expect(ship.score).toBe(200);
		expect(world.asteroids.size).toBe(2); // розколовся на 2 менші уламки
	});
	it("misses distant targets cleanly", () => {
		const world = new SharedWorld({
			width: 1200,
			height: 760,
			seed: 10,
			initialAsteroids: 0,
		});
		const ship = world.spawnShip({
			ownerId: "p1",
			ownerSlot: asOwnerSlot(1),
			name: "Andrii",
		});
		ship.pos = new Vector2(100, 100);
		const ast = new SimAsteroid({
			id: world.allocId(),
			x: 800,
			y: 600,
			vx: 0,
			vy: 0,
			size: 2,
		});
		world.asteroids.set(ast.id, ast);
		world.step(1 / 30);
		expect(ast.alive).toBe(true);
		expect(ship.hp).toBe(100);
	});
	it("handles homing missile guidance and bullet TTL expiration", () => {
		const world = new SharedWorld({
			width: 1200,
			height: 760,
			seed: 77,
			initialAsteroids: 0,
		});
		const s1 = world.spawnShip({
			ownerId: "p1",
			ownerSlot: asOwnerSlot(1),
			name: "P1",
		});
		const s2 = world.spawnShip({
			ownerId: "p2",
			ownerSlot: asOwnerSlot(2),
			name: "P2",
		});
		s1.pos = new Vector2(200, 200);
		s2.pos = new Vector2(350, 260);
		s2.shieldTimer = 0;
		const missile = world.spawnBulletFromShip(s1, true, asSeq(1));
		const initialAngle = missile.angle;
		world.step(1 / 30);
		expect(missile.angle).not.toBe(initialAngle);
		// Прокручуємо 90 тіків, щоб снаряд вичерпав TTL і повернувся у пул
		for (let i = 0; i < 90; i += 1) {
			world.step(1 / 30);
		}
		expect(world.bullets.size).toBe(0);
	});
	it("collects pickups and damages ships colliding with asteroids", () => {
		const world = new SharedWorld({
			width: 1200,
			height: 760,
			seed: 33,
			initialAsteroids: 0,
		});
		const ship = world.spawnShip({
			ownerId: "p1",
			ownerSlot: asOwnerSlot(1),
			name: "P1",
		});
		ship.pos = new Vector2(400, 400);
		ship.shieldTimer = 0;
		const pickup = new SimPickup({
			id: world.allocId(),
			x: 405,
			y: 400,
			pickupType: "rapid",
		});
		world.pickups.set(pickup.id, pickup);
		world.step(1 / 30);
		expect(ship.rapidFireTimer).toBeGreaterThan(0);
		expect(ship.score).toBe(50);
		const ast = new SimAsteroid({
			id: world.allocId(),
			x: 405,
			y: 400,
			vx: 0,
			vy: 0,
			size: 1,
		});
		world.asteroids.set(ast.id, ast);
		world.step(1 / 30);
		expect(ship.hp).toBe(70);
	});
	it("produces identical stateHash across 500 deterministic steps", () => {
		const run = () => {
			const w = new SharedWorld({
				width: 1200,
				height: 760,
				seed: 2026,
				initialAsteroids: 5,
			});
			w.spawnShip({ ownerId: "p1", ownerSlot: asOwnerSlot(1), name: "Andrii" });
			w.spawnShip({ ownerId: "p2", ownerSlot: asOwnerSlot(2), name: "Bot" });
			w.spawnWave(5);
			for (let i = 0; i < 500; i += 1) {
				const map = new Map([
					[
						"p1",
						{
							seq: asSeq(i + 1),
							thrust: 1,
							turn: i % 10 === 0 ? 1 : 0,
							fire: i % 12 === 0,
							missile: false,
							clientTick: i,
						},
					],
				]);
				w.step(1 / 30, map);
			}
			return w.stateHash();
		};
		expect(run()).toBe(run());
	});
});
describe("Protocol & Binary Codec edge cases", () => {
	it("encodes and decodes input & snapshot in Binary and JSON", () => {
		const cmd = toPlayerInputCommand({
			type: "input",
			seq: 77,
			thrust: -1,
			turn: 1,
			fire: true,
			missile: true,
			clientTick: 12,
		});
		expect(decodeInputBinary(encodeInputBinary(cmd))).toEqual(cmd);
		const world = new SharedWorld({ initialAsteroids: 2 });
		world.spawnShip({ ownerId: "p1", ownerSlot: asOwnerSlot(1), name: "P1" });
		world.spawnWave(2);
		const snap = world.toSnapshot(asSeq(77));
		const binBuf = BinarySnapshotCodec.encode(snap);
		expect(binBuf).toBeInstanceOf(ArrayBuffer);
		const decoded = decodeSnapshotBinary(binBuf);
		expect(decoded.tick).toBe(snap.tick);
		expect(decoded.entities.length).toBe(snap.entities.length);
		const jsonStr = JsonSnapshotCodec.encode(snap);
		expect(typeof jsonStr).toBe("string");
	});
	it("rejects corrupted binary headers, lengths, axes and unknown entity kinds", () => {
		expect(() => decodeInputBinary(new ArrayBuffer(5))).toThrow();
		const badInput = new ArrayBuffer(12);
		const iv = new DataView(badInput);
		iv.setUint8(0, BIN_VERSION);
		iv.setUint8(1, BIN_MSG_INPUT);
		iv.setInt8(6, 5); // невалідний thrust = 5
		expect(() => decodeInputBinary(badInput)).toThrow();
		expect(() => decodeSnapshotBinary(new ArrayBuffer(4))).toThrow();
		const badSnap = new ArrayBuffer(36);
		const sv = new DataView(badSnap);
		sv.setUint8(0, BIN_VERSION);
		sv.setUint8(1, BIN_MSG_SNAPSHOT);
		sv.setUint16(10, 1, true);
		sv.setUint8(14, 99); // невідомий kindCode = 99
		expect(() => decodeSnapshotBinary(badSnap)).toThrow();
	});
	it("parses all valid client message types and rejects malformed ones", () => {
		expect(
			parseClientMessage({ type: "join", room: "arena", name: "Andrii" }).ok,
		).toBe(true);
		expect(parseClientMessage({ type: "ping", clientTime: 100 }).ok).toBe(true);
		expect(
			parseClientMessage({
				type: "netSim",
				latencyMs: 50,
				jitterMs: 10,
				dropRate: 0.01,
			}).ok,
		).toBe(true);
		expect(parseClientMessage("{bad-json").ok).toBe(false);
		expect(parseClientMessage({ type: "unknown_type" }).ok).toBe(false);
	});
});
