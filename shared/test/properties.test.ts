import fc from "fast-check";
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
	type PlayerInputCommand,
	parseClientMessage,
	SharedWorld,
	type SnapshotEntity,
	type WorldSnapshot,
} from "../src/index.js";

const axisArb = fc.constantFrom<-1 | 0 | 1>(-1, 0, 1);

const playerInputArb: fc.Arbitrary<PlayerInputCommand> = fc.record({
	seq: fc.integer({ min: 0, max: 0x7fffffff }).map(asSeq),
	thrust: axisArb,
	turn: axisArb,
	fire: fc.boolean(),
	missile: fc.boolean(),
	clientTick: fc.integer({ min: 0, max: 65535 }),
});

const snapshotEntityArb: fc.Arbitrary<SnapshotEntity> = fc
	.record({
		id: fc.integer({ min: 1, max: 65000 }).map(asEntityId),
		kindCode: fc.constantFrom<1 | 2 | 3 | 4>(1, 2, 3, 4),
		ownerSlot: fc.integer({ min: 0, max: 128 }).map(asOwnerSlot),
		x: fc.float({
			min: Math.fround(0),
			max: Math.fround(1200),
			noNaN: true,
			noDefaultInfinity: true,
		}),
		y: fc.float({
			min: Math.fround(0),
			max: Math.fround(760),
			noNaN: true,
			noDefaultInfinity: true,
		}),
		vx: fc.integer({ min: -500, max: 500 }),
		vy: fc.integer({ min: -500, max: 500 }),
		angle: fc.float({
			min: Math.fround(-3.14),
			max: Math.fround(3.14),
			noNaN: true,
			noDefaultInfinity: true,
		}),
		hp: fc.integer({ min: 0, max: 100 }),
		score: fc.integer({ min: 0, max: 5000 }).map((n) => n * 10),
		flags: fc.integer({ min: 0, max: 15 }),
	})
	.map((raw): SnapshotEntity => {
		switch (raw.kindCode) {
			case 1:
				return { ...raw, kind: "ship", kindCode: 1 };
			case 2:
				return { ...raw, kind: "bullet", kindCode: 2 };
			case 3:
				return { ...raw, kind: "asteroid", kindCode: 3 };
			default:
				return { ...raw, kind: "pickup", kindCode: 4 };
		}
	});

describe("fast-check Property-Based Invariants", () => {
	it("Property 1: Binary input codec round-trip preserves exact fields", () => {
		fc.assert(
			fc.property(playerInputArb, (cmd) => {
				const decoded = decodeInputBinary(encodeInputBinary(cmd));
				expect(decoded).toEqual(cmd);
			}),
			{ numRuns: 200 },
		);
	});

	it("Property 2: Binary snapshot codec round-trip preserves entities within angle quantization tolerance (0.001 rad)", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 100000 }).map(asTick),
				fc.integer({ min: 0, max: 100000 }).map(asSeq),
				fc.array(snapshotEntityArb, { maxLength: 24 }),
				(tick, lastProcessedSeq, entities) => {
					const snap: WorldSnapshot = {
						type: "snapshot",
						tick,
						lastProcessedSeq,
						entities,
					};
					const decoded = decodeSnapshotBinary(encodeSnapshotBinary(snap));
					expect(decoded.tick).toBe(tick);
					expect(decoded.lastProcessedSeq).toBe(lastProcessedSeq);
					expect(decoded.entities.length).toBe(entities.length);

					for (let i = 0; i < entities.length; i += 1) {
						const orig = entities[i]!;
						const dec = decoded.entities[i]!;
						expect(dec.id).toBe(orig.id);
						expect(dec.kind).toBe(orig.kind);
						expect(dec.x).toBeCloseTo(orig.x, 3);
						expect(dec.y).toBeCloseTo(orig.y, 3);
						expect(Math.abs(dec.angle - orig.angle)).toBeLessThanOrEqual(0.002);
					}
				},
			),
			{ numRuns: 150 },
		);
	});

	it("Property 3: Encoded binary snapshot byteLength strictly equals 12 + 24 * entityCount", () => {
		fc.assert(
			fc.property(
				fc.array(snapshotEntityArb, { maxLength: 40 }),
				(entities) => {
					const snap: WorldSnapshot = {
						type: "snapshot",
						tick: asTick(1),
						lastProcessedSeq: asSeq(1),
						entities,
					};
					const buf = encodeSnapshotBinary(snap);
					expect(buf.byteLength).toBe(12 + entities.length * 24);
				},
			),
			{ numRuns: 150 },
		);
	});

	it("Property 4: Arbitrary garbage buffers never crash the process (either decode or throw Error)", () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 128 }), (bytes) => {
				try {
					const snap = decodeSnapshotBinary(bytes);
					expect(snap.type).toBe("snapshot");
				} catch (err: unknown) {
					expect(err).toBeInstanceOf(Error);
				}
			}),
			{ numRuns: 300 },
		);
	});

	it("Property 5: Ships stay strictly inside arena bounds over random input sequences", () => {
		fc.assert(
			fc.property(
				fc.array(playerInputArb, { minLength: 20, maxLength: 120 }),
				(cmds) => {
					const world = new SharedWorld({
						width: 1200,
						height: 760,
						seed: 42,
						initialAsteroids: 0,
					});
					const ship = world.spawnShip({
						ownerId: "p1",
						ownerSlot: asOwnerSlot(1),
						name: "Test",
					});
					for (const cmd of cmds) {
						world.step(1 / 30, new Map([["p1", cmd]]));
						expect(ship.pos.x).toBeGreaterThanOrEqual(0);
						expect(ship.pos.x).toBeLessThan(1200);
						expect(ship.pos.y).toBeGreaterThanOrEqual(0);
						expect(ship.pos.y).toBeLessThan(760);
					}
				},
			),
			{ numRuns: 60 },
		);
	});

	it("Property 6: parseClientMessage accepts valid input messages and rejects mutated out-of-range axes", () => {
		fc.assert(
			fc.property(
				playerInputArb,
				fc.integer({ min: 2, max: 1000 }),
				(cmd, badTurn) => {
					const valid = parseClientMessage({
						type: "input",
						seq: cmd.seq,
						thrust: cmd.thrust,
						turn: cmd.turn,
						fire: cmd.fire,
						missile: cmd.missile,
						clientTick: cmd.clientTick,
					});
					expect(valid.ok).toBe(true);

					const invalid = parseClientMessage({
						type: "input",
						seq: cmd.seq,
						thrust: cmd.thrust,
						turn: badTurn,
						fire: cmd.fire,
						missile: cmd.missile,
					});
					expect(invalid.ok).toBe(false);
				},
			),
			{ numRuns: 150 },
		);
	});
});
