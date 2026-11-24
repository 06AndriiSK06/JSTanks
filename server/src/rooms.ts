import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
	asOwnerSlot,
	asSeq,
	BinarySnapshotCodec,
	JsonSnapshotCodec,
	type OwnerSlot,
	type PlayerInputCommand,
	type RoomSummaryInfo,
	type RosterPlayerInfo,
	type Seq,
	SharedWorld,
	type SimGameEvent,
	type SnapshotCodec,
} from "@jstanks/shared";
import type { WebSocket } from "ws";
import {
	createMatchLogger,
	type MatchLogEntry,
	type MatchLogger,
} from "./log/matchlog.js";

const TICK_RATE = 30;
const TICK_INTERVAL_MS = 1000 / TICK_RATE;
const FIXED_DT = 1 / TICK_RATE;

export interface RoomPlayer {
	readonly id: string;
	readonly ownerSlot: OwnerSlot;
	readonly name: string;
	readonly joinedAt: number;
	readonly socket: WebSocket;
	readonly codec: SnapshotCodec;
	readonly inputQueue: PlayerInputCommand[];
	lastProcessedSeq: Seq;
	lastInput: PlayerInputCommand | null;
}

export interface RoomEventMap {
	join: [player: RoomPlayer];
	leave: [player: RoomPlayer];
	chat: [payload: { playerId: string; name: string; text: string }];
	event: [entry: MatchLogEntry];
	snapshot: [payload: { world: SharedWorld; events: readonly SimGameEvent[] }];
	empty: [roomId: string];
	error: [err: unknown];
}

export interface RoomTickStats {
	readonly tickRate: number;
	lastDurationMs: number;
	avgDurationMs: number;
	maxJitterMs: number;
}

export class Room extends EventEmitter<RoomEventMap> {
	private tickTimer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private nextTickTime = 0;
	private nextOwnerSlot = 1;

	readonly id: string;
	readonly name: string;
	readonly difficulty: string;
	readonly initialAsteroids: number;
	readonly maxPlayers: number;
	readonly players = new Map<string, RoomPlayer>();
	readonly seed: number;
	readonly world: SharedWorld;
	readonly tickStats: RoomTickStats;
	private readonly loggerPromise: Promise<MatchLogger>;

	constructor(params: {
		id: string;
		name: string;
		difficulty?: string;
		initialAsteroids?: number;
		maxPlayers?: number;
		logDir: string;
	}) {
		super();
		this.id = params.id;
		this.name = params.name;
		this.difficulty = params.difficulty ?? "Normal";
		this.initialAsteroids = params.initialAsteroids ?? 5;
		this.maxPlayers = params.maxPlayers ?? 8;
		this.seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
		this.world = new SharedWorld({
			width: 1200,
			height: 760,
			seed: this.seed,
			initialAsteroids: this.initialAsteroids,
		});
		this.world.spawnWave(this.initialAsteroids);

		this.tickStats = {
			tickRate: TICK_RATE,
			lastDurationMs: 0,
			avgDurationMs: 0,
			maxJitterMs: 0,
		};

		this.loggerPromise = createMatchLogger({
			logDir: params.logDir,
			roomId: this.id,
		});
		this.startLoop();
	}

	private startLoop(): void {
		if (this.running) return;
		this.running = true;
		this.nextTickTime = performance.now() + TICK_INTERVAL_MS;

		const stepLoop = (): void => {
			if (!this.running) return;
			const now = performance.now();
			const jitter = Math.abs(now - this.nextTickTime);
			this.tickStats.maxJitterMs = Math.max(
				this.tickStats.maxJitterMs * 0.98,
				jitter,
			);

			this.tick();

			const elapsed = performance.now() - now;
			this.tickStats.lastDurationMs = elapsed;
			this.tickStats.avgDurationMs =
				this.tickStats.avgDurationMs * 0.9 + elapsed * 0.1;

			this.nextTickTime += TICK_INTERVAL_MS;
			if (this.nextTickTime < performance.now()) {
				this.nextTickTime = performance.now() + TICK_INTERVAL_MS;
			}
			this.tickTimer = setTimeout(
				stepLoop,
				Math.max(0, this.nextTickTime - performance.now()),
			);
		};

		this.tickTimer = setTimeout(stepLoop, TICK_INTERVAL_MS);
	}

	private tick(): void {
		if (this.players.size === 0) return;

		const inputsByOwner = new Map<string, PlayerInputCommand>();
		for (const player of this.players.values()) {
			const nextInput = player.inputQueue.shift();
			if (nextInput) {
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

	get playerCount(): number {
		return this.players.size;
	}

	getRoster(): RosterPlayerInfo[] {
		return Array.from(this.players.values()).map((p) => ({
			id: p.id,
			ownerSlot: p.ownerSlot,
			name: p.name,
			joinedAt: p.joinedAt,
		}));
	}

	toSummary(): RoomSummaryInfo {
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

	recordEvent(entry: MatchLogEntry): void {
		this.emit("event", entry);
		this.loggerPromise
			.then((logger) => logger.logEvent(entry))
			.catch((err: unknown) => this.emit("error", err));
	}

	join(params: {
		id: string;
		name: string;
		codecMode: "binary" | "json";
		joinedAt: number;
		socket: WebSocket;
	}): RoomPlayer | null {
		if (this.players.size >= this.maxPlayers) {
			return null;
		}
		const ownerSlot = asOwnerSlot(this.nextOwnerSlot++);
		const player: RoomPlayer = {
			id: params.id,
			ownerSlot,
			name: params.name,
			joinedAt: params.joinedAt,
			socket: params.socket,
			codec:
				params.codecMode === "json" ? JsonSnapshotCodec : BinarySnapshotCodec,
			inputQueue: [],
			lastProcessedSeq: asSeq(0),
			lastInput: null,
		};

		this.players.set(player.id, player);
		this.world.spawnShip({ ownerId: player.id, ownerSlot, name: player.name });

		this.recordEvent({
			type: "join",
			playerId: player.id,
			ownerSlot,
			name: player.name,
		});
		this.emit("join", player);
		return player;
	}

	enqueueInput(playerId: string, input: PlayerInputCommand): void {
		const player = this.players.get(playerId);
		if (!player) return;
		if (input.seq <= player.lastProcessedSeq) return;
		if (player.inputQueue.length >= 16) {
			player.inputQueue.shift();
		}
		player.inputQueue.push(input);
	}

	leave(playerId: string): void {
		const player = this.players.get(playerId);
		if (!player) return;
		this.players.delete(playerId);
		this.world.removeShip(playerId);

		this.recordEvent({ type: "leave", playerId: player.id, name: player.name });
		this.emit("leave", player);

		if (this.players.size === 0) {
			this.emit("empty", this.id);
		}
	}

	chat(player: RoomPlayer, text: string): void {
		const payload = { playerId: player.id, name: player.name, text };
		this.recordEvent({ type: "chat", ...payload });
		this.emit("chat", payload);
	}

	async closeLogger(): Promise<void> {
		this.running = false;
		if (this.tickTimer !== null) {
			clearTimeout(this.tickTimer);
			this.tickTimer = null;
		}
		const logger = await this.loggerPromise;
		await logger.close();
	}
}

export class RoomManager {
	private readonly rooms = new Map<string, Room>();
	private readonly logDir: string;
	private readonly maxRooms: number;
	private readonly maxPlayersPerRoom: number;

	constructor(params: {
		logDir: string;
		maxRooms?: number;
		maxPlayersPerRoom?: number;
	}) {
		this.logDir = params.logDir;
		this.maxRooms = params.maxRooms ?? 20;
		this.maxPlayersPerRoom = params.maxPlayersPerRoom ?? 8;
		this.seedDefaults();
	}

	private seedDefaults(): void {
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

	listRooms(): RoomSummaryInfo[] {
		return Array.from(this.rooms.values()).map((r) => r.toSummary());
	}

	getStats(): Array<
		{ id: string; players: number; tick: number } & RoomTickStats
	> {
		return Array.from(this.rooms.values()).map((r) => ({
			id: r.id,
			players: r.playerCount,
			tick: r.world.tick,
			...r.tickStats,
		}));
	}

	getRoom(id: string): Room | undefined {
		return this.rooms.get(id);
	}

	createRoom(params: {
		id?: string;
		name?: string;
		difficulty?: string;
		initialAsteroids?: number;
		persistent?: boolean;
	}): Room {
		const id = params.id ?? `room-${randomUUID().slice(0, 6)}`;
		const existing = this.rooms.get(id);
		if (existing) {
			return existing;
		}
		if (this.rooms.size >= this.maxRooms) {
			throw new Error(`Maximum room limit reached (${this.maxRooms})`);
		}

		const room = new Room({
			id,
			name: params.name ?? `Arena ${id}`,
			difficulty: params.difficulty ?? "Normal",
			initialAsteroids: params.initialAsteroids ?? 5,
			maxPlayers: this.maxPlayersPerRoom,
			logDir: this.logDir,
		});

		room.on("error", (err: unknown) => {
			console.error(`[Room ${room.id} error]`, err);
		});

		if (!params.persistent) {
			room.once("empty", () => {
				this.rooms.delete(room.id);
				void room.closeLogger().then(() => {
					console.log(`[RoomManager] Deleted empty room: ${room.id}`);
				});
			});
		}

		this.rooms.set(room.id, room);
		return room;
	}

	async closeAll(): Promise<void> {
		const tasks: Array<Promise<void>> = [];
		for (const room of this.rooms.values()) {
			tasks.push(room.closeLogger());
		}
		await Promise.allSettled(tasks);
	}
}
