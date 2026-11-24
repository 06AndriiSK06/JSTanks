import assert from "node:assert/strict";
import test from "node:test";
import {
	decodeInputBinary,
	decodeSnapshotBinary,
	encodeInputBinary,
	encodeSnapshotBinary,
	SharedWorld,
} from "../src/index.js";

test("Deterministic simulation: 1000 steps with identical inputs produce identical state hash", () => {
	const runSim = () => {
		const world = new SharedWorld({
			width: 1200,
			height: 760,
			seed: 98765,
			initialAsteroids: 5,
		});
		world.spawnShip({ ownerId: "p1", name: "Andrii" });
		world.spawnShip({ ownerId: "p2", name: "Player2" });
		world.spawnWave(5);

		const dt = 1 / 30;
		for (let step = 0; step < 1000; step += 1) {
			const inputs = new Map();
			inputs.set("p1", {
				seq: step + 1,
				thrust: step % 40 < 25 ? 1 : 0,
				turn: step % 60 < 20 ? 1 : -1,
				fire: step % 15 === 0,
				missile: step % 90 === 0,
			});
			inputs.set("p2", {
				seq: step + 1,
				thrust: 1,
				turn: step % 50 < 25 ? -1 : 1,
				fire: step % 20 === 0,
				missile: false,
			});
			world.step(dt, inputs);
		}
		return world.stateHash();
	};

	const hashA = runSim();
	const hashB = runSim();
	assert.equal(hashA, hashB);
});

test("Binary DataView input codec round-trip", () => {
	const original = {
		seq: 4219,
		thrust: 1,
		turn: -1,
		fire: true,
		missile: false,
		clientTick: 512,
	};
	const buf = encodeInputBinary(original);
	assert.equal(buf.byteLength, 12);

	const decoded = decodeInputBinary(buf);
	assert.equal(decoded.seq, original.seq);
	assert.equal(decoded.thrust, original.thrust);
	assert.equal(decoded.turn, original.turn);
	assert.equal(decoded.fire, original.fire);
	assert.equal(decoded.missile, original.missile);
	assert.equal(decoded.clientTick, original.clientTick);
});

test("Binary DataView snapshot codec round-trip and JSON vs Binary size benchmark", () => {
	const world = new SharedWorld({
		width: 1200,
		height: 760,
		seed: 42,
		initialAsteroids: 6,
	});
	for (let i = 1; i <= 4; i += 1) {
		const s = world.spawnShip({ ownerId: `p${i}`, name: `Pilot${i}` });
		s.ownerSlot = i;
	}
	world.spawnWave(6);
	world.step(1 / 30);

	const snap = world.toSnapshot(128);
	for (let i = 0; i < snap.entities.length; i += 1) {
		snap.entities[i].ownerSlot = i + 1;
	}

	const binBuf = encodeSnapshotBinary(snap);
	const decoded = decodeSnapshotBinary(binBuf);

	assert.equal(decoded.tick, snap.tick);
	assert.equal(decoded.lastProcessedSeq, snap.lastProcessedSeq);
	assert.equal(decoded.entities.length, snap.entities.length);

	for (let i = 0; i < snap.entities.length; i += 1) {
		const a = snap.entities[i];
		const b = decoded.entities[i];
		assert.equal(b.id, a.id);
		assert.equal(b.kindCode, a.kindCode);
		assert.ok(Math.abs(b.x - a.x) < 0.001);
		assert.ok(Math.abs(b.y - a.y) < 0.001);
		assert.ok(Math.abs(b.angle - a.angle) <= 0.001);
	}

	// Бенчмарк JSON проти Binary для 4 гравців @ 30 Hz
	const jsonStr = JSON.stringify(snap);
	const jsonBytes = new TextEncoder().encode(jsonStr).byteLength;
	const binBytes = binBuf.byteLength;

	const t0 = performance.now();
	for (let i = 0; i < 1000; i += 1) {
		JSON.parse(JSON.stringify(snap));
	}
	const jsonUs = ((performance.now() - t0) * 1000) / 1000;

	const t1 = performance.now();
	for (let i = 0; i < 1000; i += 1) {
		decodeSnapshotBinary(encodeSnapshotBinary(snap));
	}
	const binUs = ((performance.now() - t1) * 1000) / 1000;

	console.log(
		`[Benchmark 4 players @ 30Hz] JSON: ${jsonBytes} B (${((jsonBytes * 30) / 1024).toFixed(2)} KB/s, ${jsonUs.toFixed(1)} us) | Binary: ${binBytes} B (${((binBytes * 30) / 1024).toFixed(2)} KB/s, ${binUs.toFixed(1)} us)`,
	);
});
