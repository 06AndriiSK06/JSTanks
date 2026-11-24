import assert from "node:assert/strict";
import test from "node:test";
import {
	asOwnerSlot,
	asSeq,
	decodeInputBinary,
	decodeSnapshotBinary,
	encodeInputBinary,
	encodeSnapshotBinary,
	type PlayerInputCommand,
	parseClientMessage,
	SharedWorld,
} from "../src/index.js";

test("Deterministic simulation in TypeScript: 1000 steps produce identical state hash", () => {
	const runSim = (): string => {
		const world = new SharedWorld({
			width: 1200,
			height: 760,
			seed: 98765,
			initialAsteroids: 5,
		});
		world.spawnShip({
			ownerId: "p1",
			ownerSlot: asOwnerSlot(1),
			name: "Andrii",
		});
		world.spawnShip({
			ownerId: "p2",
			ownerSlot: asOwnerSlot(2),
			name: "Player2",
		});
		world.spawnWave(5);

		const dt = 1 / 30;
		for (let step = 0; step < 1000; step += 1) {
			const inputs = new Map<string, PlayerInputCommand>();
			inputs.set("p1", {
				seq: asSeq(step + 1),
				thrust: step % 40 < 25 ? 1 : 0,
				turn: step % 60 < 20 ? 1 : -1,
				fire: step % 15 === 0,
				missile: step % 90 === 0,
				clientTick: step,
			});
			inputs.set("p2", {
				seq: asSeq(step + 1),
				thrust: 1,
				turn: step % 50 < 25 ? -1 : 1,
				fire: step % 20 === 0,
				missile: false,
				clientTick: step,
			});
			world.step(dt, inputs);
		}
		return world.stateHash();
	};

	assert.equal(runSim(), runSim());
});

test("Zod parseClientMessage rejects malformed JSON and out-of-range cheat input without throwing", () => {
	const badJson = parseClientMessage("{broken-json");
	assert.equal(badJson.ok, false);

	const cheatTurn = parseClientMessage({
		type: "input",
		seq: 1,
		thrust: 1,
		turn: 99,
		fire: false,
		missile: false,
	});
	assert.equal(cheatTurn.ok, false);

	const validChat = parseClientMessage(
		JSON.stringify({ type: "chat", text: "Hello TS!" }),
	);
	assert.equal(validChat.ok, true);
	if (validChat.ok && validChat.msg.type === "chat") {
		assert.equal(validChat.msg.text, "Hello TS!");
	}
});

test("Binary DataView input and snapshot round-trip", () => {
	const original: PlayerInputCommand = {
		seq: asSeq(4219),
		thrust: 1,
		turn: -1,
		fire: true,
		missile: false,
		clientTick: 512,
	};
	const decodedInput = decodeInputBinary(encodeInputBinary(original));
	assert.deepEqual(decodedInput, original);

	const world = new SharedWorld({
		width: 1200,
		height: 760,
		seed: 42,
		initialAsteroids: 4,
	});
	world.spawnShip({ ownerId: "p1", ownerSlot: asOwnerSlot(1), name: "Pilot1" });
	world.spawnWave(4);
	world.step(1 / 30);

	const snap = world.toSnapshot(asSeq(128));
	const decodedSnap = decodeSnapshotBinary(encodeSnapshotBinary(snap));
	assert.equal(decodedSnap.tick, snap.tick);
	assert.equal(decodedSnap.lastProcessedSeq, snap.lastProcessedSeq);
	assert.equal(decodedSnap.entities.length, snap.entities.length);
});
