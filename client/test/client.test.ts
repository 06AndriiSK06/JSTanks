import {
	asEntityId,
	asOwnerSlot,
	asSeq,
	asTick,
	type WorldSnapshot,
} from "@jstanks/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bus } from "../src/bus.js";
import { createLoop } from "../src/loop.js";
import { NetworkSession } from "../src/net/predictor.js";
import { ParticleSystem } from "../src/render/particles.js";

describe("Typed Event Bus<E>", () => {
	it("delivers typed payloads and unsubscribes cleanly", () => {
		const bus = new Bus<{ hit: { dmg: number }; reset: undefined }>();
		const received: number[] = [];
		const off = bus.on("hit", (p) => received.push(p.dmg));

		bus.emit("hit", { dmg: 25 });
		off();
		bus.emit("hit", { dmg: 50 });

		expect(received).toEqual([25]);
	});
});

describe("Fixed-timestep loop with fake timers", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("steps simulation at fixed 30Hz accumulator intervals under fake timers", () => {
		vi.useFakeTimers();
		let rafId = 0;
		const callbacks = new Map<number, (now: number) => void>();

		vi.stubGlobal("requestAnimationFrame", (cb: (now: number) => void) => {
			const id = ++rafId;
			callbacks.set(id, cb);
			return id;
		});

		let steps = 0;
		let renders = 0;
		const loop = createLoop({
			step: 1 / 30,
			simulate: () => {
				steps += 1;
			},
			render: () => {
				renders += 1;
			},
		});

		loop.start();
		// Симулюємо 3 кадри по 33.4 мс (~100 мс сумарно = 3 кроки фізики)
		let now = performance.now();
		for (let i = 0; i < 3; i += 1) {
			now += 34;
			const entry = Array.from(callbacks.entries())[0];
			if (entry) {
				callbacks.delete(entry[0]);
				entry[1](now);
			}
		}

		loop.stop();
		expect(steps).toBe(3);
		expect(renders).toBe(3);
	});
});

describe("Client-Side Prediction & Server Reconciliation", () => {
	it("predicts local ship movement immediately and reconciles with authoritative snapshot", () => {
		const session = new NetworkSession({ arenaWidth: 1200, arenaHeight: 760 });
		session.setIdentity({
			playerId: "p1",
			ownerSlot: 1,
			roster: [{ id: "p1", ownerSlot: 1, name: "Andrii", joinedAt: 0 }],
		});

		const initialSnap: WorldSnapshot = {
			type: "snapshot",
			tick: asTick(100),
			lastProcessedSeq: asSeq(0),
			entities: [
				{
					id: asEntityId(1),
					kind: "ship",
					kindCode: 1,
					ownerSlot: asOwnerSlot(1),
					x: 300,
					y: 300,
					vx: 0,
					vy: 0,
					angle: 0,
					hp: 100,
					score: 0,
					flags: 1,
				},
			],
		};

		session.onSnapshot(initialSnap);
		expect(session.localShip?.pos.x).toBe(300);

		// Клієнт робить 3 кроки вперед (seq 1, 2, 3)
		session.stepLocalPrediction(1 / 30, {
			thrust: 1,
			turn: 0,
			fire: false,
			missile: false,
		});
		session.stepLocalPrediction(1 / 30, {
			thrust: 1,
			turn: 0,
			fire: false,
			missile: false,
		});
		session.stepLocalPrediction(1 / 30, {
			thrust: 1,
			turn: 0,
			fire: false,
			missile: false,
		});
		expect(session.pendingInputs.length).toBe(3);
		const predictedX = session.localShip?.pos.x;
		expect(predictedX).toBeGreaterThan(300);

		// Приходить знімок сервера з підтвердженням seq = 1: звірка має перепрограти seq 2 і 3
		session.onSnapshot({
			...initialSnap,
			tick: asTick(101),
			lastProcessedSeq: asSeq(1),
			entities: [
				{
					...initialSnap.entities[0],
					x: 300.37,
					vx: 11.2,
				},
			],
		});

		expect(session.pendingInputs.length).toBe(2);
		expect(session.lastCorrectionPx).toBeLessThan(1.0);
	});

	it("interpolates remote entities between buffered snapshots", () => {
		const session = new NetworkSession({ arenaWidth: 1200, arenaHeight: 760 });
		session.setIdentity({ playerId: "p1", ownerSlot: 1 });
		session.interpolationDelayMs = 0;

		session.onSnapshot({
			type: "snapshot",
			tick: asTick(1),
			lastProcessedSeq: asSeq(0),
			entities: [
				{
					id: asEntityId(2),
					kind: "ship",
					kindCode: 1,
					ownerSlot: asOwnerSlot(2),
					x: 500,
					y: 400,
					vx: 100,
					vy: 0,
					angle: 0,
					hp: 100,
					score: 0,
					flags: 1,
				},
			],
		});

		const renderList = session.getRenderEntities();
		expect(renderList.length).toBe(1);
		expect(renderList[0]?.kind).toBe("ship");
	});
});

describe("ParticleSystem fallback pool", () => {
	it("spawns and steps explosion particles in main-thread fallback mode without errors", () => {
		const ps = new ParticleSystem();
		ps.useWorker = false;
		ps.spawnExplosion(250, 250, 20);
		ps.step(1 / 30);
		expect(ps.lastStepUs).toBeGreaterThanOrEqual(0);
	});
});
