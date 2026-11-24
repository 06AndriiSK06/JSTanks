import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { SharedWorld } from "@jstanks/shared";
import { createMatchLogger } from "./log/matchlog.js";

const TICK_RATE = 30;
const TICK_INTERVAL_MS = 1000 / TICK_RATE;
const FIXED_DT = 1 / TICK_RATE;

export class Room extends EventEmitter {
	#tickTimer = null;
	#running = false;
	#nextTickTime = 0;
	#nextOwnerSlot = 1;

	constructor({
		id,
		name,
		difficulty = "Normal",
		initialAsteroids = 5,
		maxPlayers = 8,
		logDir,
	}) {
		super();
		this.id = id;
		this.name = name;
		this.difficulty = difficulty;
		this.initialAsteroids = initialAsteroids;
		this.maxPlayers = maxPlayers;
		this.players = new Map();
		this.seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
		this.world = new SharedWorld({
			width: 1200,
			height: 760,
			seed: this.seed,
			initialAsteroids,
		});
		this.world.spawnWave(initialAsteroids);

		this.tickStats = {
			tickRate: TICK_RATE,
			lastDurationMs: 0,
			avgDurationMs: 0,
			maxJitterMs: 0,
		};

		this.loggerPromise = createMatchLogger({ logDir, roomId: id });
		this.#startLoop();
	}

	#startLoop() {
		if (this.#running) return;
		this.#running = true;
		this.#nextTickTime = performance.now() + TICK_INTERVAL_MS;

		const stepLoop = () => {
			if (!this.#running) return;
			const now = performance.now();
			const jitter = Math.abs(now - this.#nextTickTime);
			this.tickStats.maxJitterMs = Math.max(
				this.tickStats.maxJitterMs * 0.98,
				jitter,
			);

			this.#tick();

			const elapsed = performance.now() - now;
			this.tickStats.lastDurationMs = elapsed;
			this.tickStats.avgDurationMs =
				this.tickStats.avgDurationMs * 0.9 + elapsed * 0.1;

			this.#nextTickTime += TICK_INTERVAL_MS;
			if (this.#nextTickTime < performance.now()) {
				this.#nextTickTime = performance.now() + TICK_INTERVAL_MS;
			}
			this.#tickTimer = setTimeout(
				stepLoop,
				Math.max(0, this.#nextTickTime - performance.now()),
			);
		};

		this.#tickTimer = setTimeout(stepLoop, TICK_INTERVAL_MS);
	}

	#tick() {
		if (this.players.size === 0) return;

		const inputsByOwner = new Map();
		for (const player of this.players.values()) {
			if (player.inputQueue.length > 0) {
				const nextInput = player.inputQueue.shift();
				inputsByOwner.set(player.id, nextInput);
				player.lastProcessedSeq = nextInput.seq;
				player.lastInput = nextInput;
			} else if (player.lastInput) {
				inputsByOwner.set(player.id, {
					...player.lastInput,
					fire: false,
					missile: false,
				});
			}
		}

		this.world.step(FIXED_DT, inputsByOwner);
		this.emit("snapshot", {
			world: this.world,
			events: this.world.events,
		});
	}

	get playerCount() {
		return this.players.size;
	}

	getRoster() {
		return Array.from(this.players.values()).map((p) => ({
			id: p.id,
			ownerSlot: p.ownerSlot,
			name: p.name,
			joinedAt: p.joinedAt,
		}));
	}

	toSummary() {
		return {
			id: this.id,
			name: this.name,
			players: this.players.size,
			maxPlayers: this.maxPlayers,
			initialAsteroids: this.initialAsteroids,
			difficulty: this.difficulty,
			seed: this.seed,
			arena: this.world.arena,
		};
	}

	recordEvent(event) {
		this.emit("event", event);
		this.loggerPromise
			.then((logger) => logger.logEvent(event))
			.catch((err) => this.emit("error", err));
	}

	join(player) {
		if (this.players.size >= this.maxPlayers) {
			return false;
		}
		const ownerSlot = this.#nextOwnerSlot++;
		const enriched = {
			...player,
			ownerSlot,
			inputQueue: [],
			lastProcessedSeq: 0,
			lastInput: null,
		};
		this.players.set(player.id, enriched);

		const ship = this.world.spawnShip({
			ownerId: player.id,
			name: player.name,
		});
		ship.ownerSlot = ownerSlot;

		const event = {
			type: "join",
			playerId: player.id,
			ownerSlot,
			name: player.name,
		};
		this.recordEvent(event);
		this.emit("join", enriched);
		return enriched;
	}

	enqueueInput(playerId, input) {
		const player = this.players.get(playerId);
		if (!player) return;
		if (input.seq <= player.lastProcessedSeq) return;
		if (player.inputQueue.length >= 16) {
			player.inputQueue.shift();
		}
		player.inputQueue.push(input);
	}

	leave(playerId) {
		const player = this.players.get(playerId);
		if (!player) return;
		this.players.delete(playerId);
		this.world.removeShip(playerId);

		const event = { type: "leave", playerId: player.id, name: player.name };
		this.recordEvent(event);
		this.emit("leave", player);

		if (this.players.size === 0) {
			this.emit("empty", this.id);
		}
	}

	chat(player, text) {
		const event = {
			type: "chat",
			playerId: player.id,
			name: player.name,
			text,
		};
		this.recordEvent(event);
		this.emit("chat", event);
	}

	async closeLogger() {
		this.#running = false;
		if (this.#tickTimer !== null) {
			clearTimeout(this.#tickTimer);
			this.#tickTimer = null;
		}
		const logger = await this.loggerPromise;
		await logger.close();
	}
}

export class RoomManager {
	#rooms = new Map();

	constructor({ logDir, maxRooms = 20, maxPlayersPerRoom = 8 }) {
		this.logDir = logDir;
		this.maxRooms = maxRooms;
		this.maxPlayersPerRoom = maxPlayersPerRoom;
		this.#seedDefaults();
	}

	#seedDefaults() {
		this.createRoom({
			id: "training-range",
			name: "Training Range (Standard)",
			difficulty: "Normal",
			initialAsteroids: 5,
			persistent: true,
		});
		this.createRoom({
			id: "iron-fortress",
			name: "Iron Fortress (Heavy Waves)",
			difficulty: "Hard",
			initialAsteroids: 8,
			persistent: true,
		});
		this.createRoom({
			id: "drone-swarm",
			name: "Drone Swarm (Homing Blitz)",
			difficulty: "Insane",
			initialAsteroids: 7,
			persistent: true,
		});
	}

	listRooms() {
		return Array.from(this.#rooms.values()).map((r) => r.toSummary());
	}

	getStats() {
		return Array.from(this.#rooms.values()).map((r) => ({
			id: r.id,
			players: r.playerCount,
			tick: r.world.tick,
			...r.tickStats,
		}));
	}

	getRoom(id) {
		return this.#rooms.get(id);
	}

	createRoom({
		id = `room-${randomUUID().slice(0, 6)}`,
		name,
		difficulty = "Normal",
		initialAsteroids = 5,
		persistent = false,
	}) {
		if (this.#rooms.has(id)) {
			return this.#rooms.get(id);
		}
		if (this.#rooms.size >= this.maxRooms) {
			throw new Error(`Maximum room limit reached (${this.maxRooms})`);
		}

		const room = new Room({
			id,
			name: name || `Arena ${id}`,
			difficulty,
			initialAsteroids,
			maxPlayers: this.maxPlayersPerRoom,
			logDir: this.logDir,
		});

		room.on("error", (err) => {
			console.error(`[Room ${room.id} error]`, err);
		});

		if (!persistent) {
			room.once("empty", async () => {
				this.#rooms.delete(room.id);
				await room.closeLogger();
				console.log(`[RoomManager] Deleted empty room: ${room.id}`);
			});
		}

		this.#rooms.set(room.id, room);
		return room;
	}

	async closeAll() {
		const tasks = [];
		for (const room of this.#rooms.values()) {
			tasks.push(room.closeLogger());
		}
		await Promise.allSettled(tasks);
	}
}
