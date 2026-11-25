import { describe, expect, it } from "vitest";
import {
	asEntityId,
	asOwnerSlot,
	asSeq,
	asTick,
	decodeInputBinary,
	decodeSnapshotBinary,
	encodeInputBinary,
	encodeSnapshotBinary,
	normalizeAngle,
	ObjectPool,
	parseClientMessage,
	SharedWorld,
	SimAsteroid,
	SimBullet,
	SimPickup,
	SimShip,
	SpatialHashGrid,
	Vector2,
	wrapCoord,
} from "../src/index.js";
describe("Extended coverage suite", () => {
	it.each([
		[0, 100, 0],
		[99.9, 100, 99.9],
		[-0.1, 100, 99.9],
		[100, 100, 0],
		[250, 200, 50],
	])("wrapCoord(%f,%f)->%f", (v, m, e) => {
		expect(wrapCoord(v, m)).toBeCloseTo(e, 5);
	});
	it.each([
		[0, 0],
		[Math.PI, Math.PI],
		[-Math.PI, -Math.PI],
		[2 * Math.PI, 0],
		[-2 * Math.PI, 0],
	])("normalizeAngle(%f)->%f", (i, e) => {
		expect(normalizeAngle(i)).toBeCloseTo(e, 5);
	});
	it("ship-vs-ship kill scoring", () => {
		const w = new SharedWorld({
			width: 1200,
			height: 760,
			seed: 1,
			initialAsteroids: 0,
		});
		const s1 = w.spawnShip({
			ownerId: "s1",
			ownerSlot: asOwnerSlot(1),
			name: "S1",
		});
		const s2 = w.spawnShip({
			ownerId: "s2",
			ownerSlot: asOwnerSlot(2),
			name: "S2",
		});
		s1.pos = new Vector2(200, 200);
		s1.angle = 0;
		s2.pos = new Vector2(226, 200);
		s2.shieldTimer = 0;
		s2.hp = 25;
		w.spawnBulletFromShip(s1, false, asSeq(1));
		w.step(1 / 30);
		expect(s2.isSpawned()).toBe(false);
		expect(s1.score).toBe(300);
	});
	it("seeker asteroid chases ship", () => {
		const a = new SimAsteroid({
			id: asEntityId(10),
			x: 100,
			y: 100,
			vx: 0,
			vy: 0,
			size: 2,
			isSeeker: true,
		});
		const s = new SimShip({
			id: asEntityId(11),
			ownerId: "p1",
			ownerSlot: asOwnerSlot(1),
			x: 250,
			y: 100,
		});
		a.step(1 / 30, { width: 1200, height: 760 }, [s]);
		expect(a.vel.x).toBeGreaterThan(0);
	});
	it("rapid pickup reduces cooldown", () => {
		const s = new SimShip({
			id: asEntityId(1),
			ownerId: "p1",
			ownerSlot: asOwnerSlot(1),
		});
		s.applyPickup("rapid");
		expect(
			s.applyInput(
				{
					seq: asSeq(1),
					thrust: 0,
					turn: 0,
					fire: true,
					missile: false,
					clientTick: 1,
				},
				1 / 30,
				{ width: 1200, height: 760 },
			),
		).toEqual({ isMissile: false });
		expect(s.fireCooldown).toBeLessThan(0.2);
	});
	it("reverse thrust moves backward", () => {
		const s = new SimShip({
			id: asEntityId(1),
			ownerId: "p1",
			ownerSlot: asOwnerSlot(1),
			x: 300,
			y: 300,
			angle: 0,
		});
		s.applyInput(
			{
				seq: asSeq(1),
				thrust: -1,
				turn: 0,
				fire: false,
				missile: false,
				clientTick: 1,
			},
			1 / 30,
			{ width: 1200, height: 760 },
		);
		expect(s.vel.x).toBeLessThan(0);
	});
	it("respawns asteroid wave when empty", () => {
		const w = new SharedWorld({
			width: 1200,
			height: 760,
			seed: 5,
			initialAsteroids: 3,
		});
		w.step(1 / 30);
		expect(w.asteroids.size).toBe(3);
	});
	it("spawns pickups periodically", () => {
		const w = new SharedWorld({
			width: 1200,
			height: 760,
			seed: 9,
			initialAsteroids: 1,
		});
		for (let i = 0; i < 650; i++) w.step(1 / 30);
		expect(w.pickups.size).toBeGreaterThanOrEqual(1);
	});
	it("removes ship on leave", () => {
		const w = new SharedWorld();
		w.spawnShip({ ownerId: "t", ownerSlot: asOwnerSlot(1), name: "T" });
		w.removeShip("t");
		expect(w.ships.has("t")).toBe(false);
	});
	it("SpatialHashGrid clear", () => {
		const g = new SpatialHashGrid(64);
		g.insert(new SimPickup({ id: asEntityId(1), x: 50, y: 50 }));
		expect(g.queryNear(50, 50, 10).length).toBe(1);
		g.clear();
		expect(g.queryNear(50, 50, 10).length).toBe(0);
	});
	it("ObjectPool grows when empty", () => {
		const p = new ObjectPool(
			() =>
				new SimBullet({
					id: asEntityId(1),
					ownerId: "p",
					ownerSlot: asOwnerSlot(1),
					x: 0,
					y: 0,
					vx: 0,
					vy: 0,
					angle: 0,
				}),
			() => {},
			1,
		);
		p.acquire();
		p.acquire();
		expect(p.totalCreated).toBe(2);
	});
	it("decodes Uint8Array slice with byteOffset", () => {
		const cmd = {
			seq: asSeq(99),
			thrust: 1,
			turn: -1,
			fire: true,
			missile: false,
			clientTick: 7,
		};
		const enc = new Uint8Array(encodeInputBinary(cmd));
		const pad = new Uint8Array(20);
		pad.set(enc, 4);
		expect(decodeInputBinary(pad.subarray(4, 16))).toEqual(cmd);
	});
	it("rejects mismatched snapshot entity count", () => {
		const buf = encodeSnapshotBinary({
			type: "snapshot",
			tick: asTick(1),
			lastProcessedSeq: asSeq(1),
			entities: [],
		});
		new DataView(buf).setUint16(10, 5, true);
		expect(() => decodeSnapshotBinary(buf)).toThrow();
	});
	it.each([
		{ type: "join", room: "", name: "A" },
		{ type: "chat", text: "" },
		{ type: "input", seq: -1, thrust: 0, turn: 0, fire: false, missile: false },
		{ type: "netSim", latencyMs: 5000, jitterMs: 0, dropRate: 0 },
	])("rejects invalid %o", (bad) => {
		expect(parseClientMessage(bad).ok).toBe(false);
	});
});
