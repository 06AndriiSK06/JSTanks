import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createMatchLogger } from "./log/matchlog.js";

export class Room extends EventEmitter {
	constructor({
		id,
		name,
		difficulty = "Normal",
		initialAsteroids = 5,
		seekerRatio = 3,
		maxPlayers = 8,
		logDir,
	}) {
		super();
		this.id = id;
		this.name = name;
		this.difficulty = difficulty;
		this.initialAsteroids = initialAsteroids;
		this.seekerRatio = seekerRatio;
		this.maxPlayers = maxPlayers;
		this.players = new Map();
		this.createdAt = Date.now();
		this.loggerPromise = createMatchLogger({ logDir, roomId: id });
	}

	get playerCount() {
		return this.players.size;
	}

	getRoster() {
		return Array.from(this.players.values()).map((p) => ({
			id: p.id,
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
			seekerRatio: this.seekerRatio,
			difficulty: this.difficulty,
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
		this.players.set(player.id, player);
		const event = { type: "join", playerId: player.id, name: player.name };
		this.recordEvent(event);
		this.emit("join", player);
		return true;
	}

	leave(playerId) {
		const player = this.players.get(playerId);
		if (!player) return;
		this.players.delete(playerId);
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
			seekerRatio: 3,
			persistent: true,
		});
		this.createRoom({
			id: "iron-fortress",
			name: "Iron Fortress (Heavy Waves)",
			difficulty: "Hard",
			initialAsteroids: 8,
			seekerRatio: 2,
			persistent: true,
		});
		this.createRoom({
			id: "drone-swarm",
			name: "Drone Swarm (Homing Blitz)",
			difficulty: "Insane",
			initialAsteroids: 7,
			seekerRatio: 1,
			persistent: true,
		});
	}

	listRooms() {
		return Array.from(this.#rooms.values()).map((r) => r.toSummary());
	}

	getRoom(id) {
		return this.#rooms.get(id);
	}

	createRoom({
		id = `room-${randomUUID().slice(0, 6)}`,
		name,
		difficulty = "Normal",
		initialAsteroids = 5,
		seekerRatio = 3,
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
			seekerRatio,
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
