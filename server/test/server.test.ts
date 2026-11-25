import os from "node:os";
import path from "node:path";
import { asOwnerSlot, asSeq } from "@jstanks/shared";
import { describe, expect, it } from "vitest";
import { BotPlayer } from "../src/bots.js";
import { loadConfig } from "../src/config.js";
import { createMatchLogger, NdjsonTransform } from "../src/log/matchlog.js";
import { listReplays, readReplayEvents } from "../src/log/replay.js";
import { RoomManager } from "../src/rooms.js";

describe("ServerConfig Zod validation", () => {
	it("loads default config when env is empty", () => {
		const cfg = loadConfig({});
		expect(cfg.port).toBe(3000);
		expect(cfg.maxPlayersPerRoom).toBe(160);
	});

	it("coerces valid numeric env vars and rejects invalid PORT", () => {
		const cfg = loadConfig({ PORT: "4500", MAX_ROOMS: "10" });
		expect(cfg.port).toBe(4500);
		expect(cfg.maxRooms).toBe(10);

		expect(() => loadConfig({ PORT: "-5" })).toThrow();
		expect(() => loadConfig({ SIM_DROP_RATE: "0.95" })).toThrow();
	});
});

describe("BotPlayer AI & RoomManager", () => {
	it("BotPlayer produces valid human-compatible PlayerInputCommand", () => {
		const mgr = new RoomManager({
			logDir: path.join(os.tmpdir(), "jstanks-test-bots"),
		});
		const room = mgr.getRoom("training-range")!;
		room.world.spawnShip({
			ownerId: "human-1",
			ownerSlot: asOwnerSlot(1),
			name: "Andrii",
		});

		const bot = new BotPlayer(2);
		room.world.spawnShip({
			ownerId: bot.id,
			ownerSlot: asOwnerSlot(2),
			name: bot.name,
		});

		const cmd = bot.decideInput(room.world, 1 / 30);
		expect([-1, 0, 1]).toContain(cmd.thrust);
		expect([-1, 0, 1]).toContain(cmd.turn);
		expect(typeof cmd.fire).toBe("boolean");
		expect(typeof cmd.missile).toBe("boolean");
	});

	it("adds and clears bots in a room and updates roster", async () => {
		const mgr = new RoomManager({
			logDir: path.join(os.tmpdir(), "jstanks-test-rooms"),
		});
		const room = mgr.createRoom({
			id: "bot-arena",
			name: "Bot Arena",
			persistent: true,
		});
		const added = room.addBots(8);
		expect(added).toBe(8);
		expect(room.playerCount).toBe(8);
		expect(room.getRoster().length).toBe(8);

		room.clearBots();
		expect(room.playerCount).toBe(0);
		await mgr.closeAll();
	});

	it("enqueues inputs in sequence order and drops stale seq", async () => {
		const mgr = new RoomManager({
			logDir: path.join(os.tmpdir(), "jstanks-test-seq"),
		});
		const room = mgr.createRoom({ id: "seq-room", persistent: true });
		const fakeSocket = {
			readyState: 1,
			send: () => {},
			close: () => {},
		} as never;
		const player = room.join({
			id: "p1",
			name: "Andrii",
			codecMode: "binary",
			joinedAt: Date.now(),
			socket: fakeSocket,
		})!;
		player.lastProcessedSeq = asSeq(10);

		room.enqueueInput("p1", {
			seq: asSeq(9),
			thrust: 1,
			turn: 0,
			fire: false,
			missile: false,
			clientTick: 1,
		});
		expect(player.inputQueue.length).toBe(0);

		room.enqueueInput("p1", {
			seq: asSeq(11),
			thrust: 1,
			turn: 0,
			fire: false,
			missile: false,
			clientTick: 2,
		});
		expect(player.inputQueue.length).toBe(1);
		await mgr.closeAll();
	});
});

describe("NDJSON MatchLog & Replay streaming", () => {
	it("writes NDJSON events and reads them back asynchronously", async () => {
		const dir = path.join(os.tmpdir(), `jstanks-ndjson-${Date.now()}`);
		const logger = await createMatchLogger({
			logDir: dir,
			roomId: "test-match",
		});
		logger.logEvent({ type: "join", name: "Andrii" });
		logger.logEvent({ type: "chat", text: "GG" });
		await logger.close();

		const files = await listReplays(dir);
		expect(files.length).toBe(1);

		const events: unknown[] = [];
		for await (const ev of readReplayEvents(logger.filePath)) {
			events.push(ev);
		}
		expect(events.length).toBe(2);
	});

	it("NdjsonTransform serializes objects with trailing newline", () => {
		const t = new NdjsonTransform();
		let out = "";
		t.on("data", (chunk: Buffer) => {
			out += chunk.toString("utf8");
		});
		t.write({ type: "ping" });
		expect(out).toBe('{"type":"ping"}\n');
	});
});
