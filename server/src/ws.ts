import { randomUUID } from "node:crypto";
import type http from "node:http";
import {
	decodeInputBinary,
	PROTOCOL_VERSION,
	parseClientMessage,
	toPlayerInputCommand,
} from "@jstanks/shared";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { ServerConfig } from "./config.js";
import type { Room, RoomManager, RoomPlayer } from "./rooms.js";

interface SocketSessionState {
	readonly id: string;
	player: RoomPlayer | null;
	room: Room | null;
	tokens: number;
	lastRefill: number;
	missedPongs: number;
}

function encodeJsonServerMsg(
	type: string,
	payload: Record<string, unknown> = {},
): string {
	return JSON.stringify({
		v: PROTOCOL_VERSION,
		type,
		t: Date.now(),
		...payload,
	});
}

function rawDataToUint8Array(raw: RawData): Uint8Array {
	if (Buffer.isBuffer(raw)) {
		return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
	}
	if (raw instanceof ArrayBuffer) {
		return new Uint8Array(raw);
	}
	const combined = Buffer.concat(raw);
	return new Uint8Array(
		combined.buffer,
		combined.byteOffset,
		combined.byteLength,
	);
}

export function attachWebSocketServer(params: {
	server: http.Server;
	roomManager: RoomManager;
	config: ServerConfig;
}): { wss: WebSocketServer; close: () => Promise<void> } {
	const { server, roomManager, config } = params;

	const wss = new WebSocketServer({
		server,
		path: "/ws",
		maxPayload: config.maxPayloadBytes,
	});

	const socketStates = new WeakMap<WebSocket, SocketSessionState>();

	const netSim = {
		latencyMs: config.simLatencyMs,
		jitterMs: config.simJitterMs,
		dropRate: config.simDropRate,
	};

	function deliverWithNetSim(fn: () => void, bypassDrop: boolean): void {
		if (!bypassDrop && netSim.dropRate > 0 && Math.random() < netSim.dropRate) {
			return;
		}
		const jitter =
			netSim.jitterMs > 0 ? (Math.random() * 2 - 1) * netSim.jitterMs : 0;
		const delay = Math.max(0, netSim.latencyMs + jitter);
		if (delay <= 0) {
			fn();
		} else {
			setTimeout(fn, delay);
		}
	}

	wss.on("error", (err: unknown) => {
		console.error("[WSS error]", err);
	});

	function safeSend(
		socket: WebSocket,
		data: string | ArrayBuffer,
		options: { critical?: boolean; bypassNetSim?: boolean } = {},
	): boolean {
		if (socket.readyState !== WebSocket.OPEN) return false;
		const critical = options.critical ?? true;

		if (!critical && socket.bufferedAmount > config.bufferedAmountLimitBytes) {
			return false;
		}
		if (socket.bufferedAmount > config.bufferedAmountLimitBytes * 4) {
			socket.close(1008, "Client too slow (send buffer overflow)");
			return false;
		}

		if (
			options.bypassNetSim ||
			(netSim.latencyMs === 0 && netSim.jitterMs === 0 && netSim.dropRate === 0)
		) {
			socket.send(data);
		} else {
			deliverWithNetSim(() => {
				if (socket.readyState === WebSocket.OPEN) {
					socket.send(data);
				}
			}, critical);
		}
		return true;
	}

	function broadcastRoom(room: Room, payload: string, critical = true): void {
		for (const player of room.players.values()) {
			safeSend(player.socket, payload, { critical });
		}
	}

	const hookedRooms = new WeakSet<Room>();
	function hookRoomSnapshots(room: Room): void {
		if (hookedRooms.has(room)) return;
		hookedRooms.add(room);

		room.on("snapshot", ({ world, events }) => {
			if (room.players.size === 0) return;

			for (const ev of events) {
				broadcastRoom(
					room,
					encodeJsonServerMsg("gameEvent", { event: ev }),
					false,
				);
			}

			for (const player of room.players.values()) {
				const snapshot = world.toSnapshot(player.lastProcessedSeq);
				const encoded = player.codec.encode(snapshot);
				safeSend(player.socket, encoded, { critical: false });
			}
		});
	}

	wss.on("connection", (socket: WebSocket) => {
		const state: SocketSessionState = {
			id: randomUUID().slice(0, 8),
			player: null,
			room: null,
			tokens: 90,
			lastRefill: Date.now(),
			missedPongs: 0,
		};
		socketStates.set(socket, state);

		socket.on("error", (err: Error) => {
			console.error(`[WS socket ${state.id} error]`, err.message);
		});

		socket.on("pong", () => {
			state.missedPongs = 0;
		});

		const joinDeadline = setTimeout(() => {
			if (!state.player && socket.readyState === WebSocket.OPEN) {
				socket.close(1008, "Join handshake timeout (5s)");
			}
		}, config.joinTimeoutMs);

		socket.on("message", (raw: RawData, isBinary: boolean) => {
			const now = Date.now();
			const elapsedSec = (now - state.lastRefill) / 1000;
			state.tokens = Math.min(90, state.tokens + elapsedSec * 60);
			state.lastRefill = now;

			if (state.tokens < 1) {
				socket.close(1008, "Rate limit exceeded");
				return;
			}
			state.tokens -= 1;

			if (isBinary) {
				if (!state.player || !state.room) return;
				try {
					const cmd = decodeInputBinary(rawDataToUint8Array(raw));
					const activeRoom = state.room;
					const activePlayer = state.player;
					deliverWithNetSim(() => {
						activeRoom.enqueueInput(activePlayer.id, cmd);
					}, false);
				} catch (err: unknown) {
					const msg =
						err instanceof Error ? err.message : "Invalid binary frame";
					console.warn(`[WS ${state.id}] ${msg}`);
					socket.close(1007, msg);
				}
				return;
			}

			const rawText = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
			const parsed = parseClientMessage(rawText);
			if (!parsed.ok) {
				console.warn(`[WS ${state.id}] Rejected message: ${parsed.reason}`);
				socket.close(parsed.code, parsed.reason);
				return;
			}

			const msg = parsed.msg;
			switch (msg.type) {
				case "ping": {
					safeSend(
						socket,
						encodeJsonServerMsg("pong", { clientTime: msg.clientTime, netSim }),
						{ critical: true },
					);
					return;
				}
				case "netSim": {
					netSim.latencyMs = msg.latencyMs;
					netSim.jitterMs = msg.jitterMs;
					netSim.dropRate = msg.dropRate;
					if (state.room) {
						broadcastRoom(
							state.room,
							encodeJsonServerMsg("netSimUpdated", { netSim }),
							true,
						);
					}
					return;
				}
				case "input": {
					if (!state.player || !state.room) return;
					const cmd = toPlayerInputCommand(msg);
					const activeRoom = state.room;
					const activePlayer = state.player;
					deliverWithNetSim(() => {
						activeRoom.enqueueInput(activePlayer.id, cmd);
					}, false);
					return;
				}
				case "join": {
					if (state.player) {
						socket.close(1002, "Already joined a room");
						return;
					}

					let room = roomManager.getRoom(msg.room);
					if (!room) {
						try {
							room = roomManager.createRoom({ id: msg.room, name: msg.room });
						} catch (err: unknown) {
							const reason =
								err instanceof Error ? err.message : "Cannot create room";
							socket.close(1013, reason);
							return;
						}
					}

					hookRoomSnapshots(room);

					const joined = room.join({
						id: state.id,
						name: msg.name,
						codecMode: msg.codec,
						joinedAt: Date.now(),
						socket,
					});

					if (!joined) {
						socket.close(1013, "Room is full");
						return;
					}

					clearTimeout(joinDeadline);
					state.player = joined;
					state.room = room;

					safeSend(
						socket,
						encodeJsonServerMsg("welcome", {
							playerId: joined.id,
							ownerSlot: joined.ownerSlot,
							codec: joined.codec.name,
							room: room.toSummary(),
							players: room.getRoster(),
						}),
						{ critical: true, bypassNetSim: true },
					);

					broadcastRoom(
						room,
						encodeJsonServerMsg("roster", {
							players: room.getRoster(),
							systemNotice: `${joined.name} joined the arena`,
						}),
						true,
					);
					return;
				}
				case "chat": {
					if (!state.player || !state.room) {
						socket.close(1002, "Must join a room before chatting");
						return;
					}
					state.room.chat(state.player, msg.text);
					broadcastRoom(
						state.room,
						encodeJsonServerMsg("chat", {
							playerId: state.player.id,
							name: state.player.name,
							text: msg.text,
						}),
						true,
					);
					return;
				}
				default: {
					const _exhaustive: never = msg;
					return _exhaustive;
				}
			}
		});

		socket.on("close", () => {
			clearTimeout(joinDeadline);
			if (state.player && state.room) {
				const { player, room } = state;
				state.player = null;
				state.room = null;
				room.leave(player.id);
				broadcastRoom(
					room,
					encodeJsonServerMsg("roster", {
						players: room.getRoster(),
						systemNotice: `${player.name} left the arena`,
					}),
					true,
				);
			}
		});
	});

	const heartbeat = setInterval(() => {
		for (const socket of wss.clients) {
			if (socket.readyState !== WebSocket.OPEN) continue;
			const st = socketStates.get(socket);
			if (!st) continue;
			if (st.missedPongs >= 2) {
				socket.terminate();
				continue;
			}
			st.missedPongs += 1;
			socket.ping();
		}
	}, config.heartbeatIntervalMs);

	return {
		wss,
		async close(): Promise<void> {
			clearInterval(heartbeat);
			for (const client of wss.clients) {
				client.close(1001, "Server shutting down");
			}
			await new Promise<void>((resolve) => wss.close(() => resolve()));
		},
	};
}
