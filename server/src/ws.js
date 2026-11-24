import { randomUUID } from "node:crypto";
import { encodeSnapshotBinary } from "@jstanks/shared";
import { WebSocket, WebSocketServer } from "ws";
import { encodeMessage, validateIncomingMessage } from "./protocol.js";

export function attachWebSocketServer({ server, roomManager, config }) {
	const wss = new WebSocketServer({
		server,
		path: "/ws",
		maxPayload: config.maxPayloadBytes,
	});

	const netSim = {
		latencyMs: Number(process.env.SIM_LATENCY_MS) || 0,
		jitterMs: Number(process.env.SIM_JITTER_MS) || 0,
		dropRate: Number(process.env.SIM_DROP_RATE) || 0,
	};

	function deliverWithNetSim(fn, { bypassDrop = false } = {}) {
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

	wss.on("error", (err) => {
		console.error("[WSS error]", err);
	});

	function safeSend(
		socket,
		data,
		{ critical = true, bypassNetSim = false } = {},
	) {
		if (socket.readyState !== WebSocket.OPEN) return false;

		if (!critical && socket.bufferedAmount > config.bufferedAmountLimitBytes) {
			return false;
		}

		if (socket.bufferedAmount > config.bufferedAmountLimitBytes * 4) {
			socket.close(1008, "Client too slow (send buffer overflow)");
			return false;
		}

		if (
			bypassNetSim ||
			(netSim.latencyMs === 0 && netSim.jitterMs === 0 && netSim.dropRate === 0)
		) {
			socket.send(data);
		} else {
			deliverWithNetSim(
				() => {
					if (socket.readyState === WebSocket.OPEN) {
						socket.send(data);
					}
				},
				{ bypassDrop: critical },
			);
		}
		return true;
	}

	function broadcastRoom(room, payload, { critical = true } = {}) {
		for (const player of room.players.values()) {
			safeSend(player.socket, payload, { critical });
		}
	}

	const hookedRooms = new WeakSet();
	function hookRoomSnapshots(room) {
		if (hookedRooms.has(room)) return;
		hookedRooms.add(room);

		room.on("snapshot", ({ world, events }) => {
			if (room.players.size === 0) return;

			for (const ev of events) {
				broadcastRoom(room, encodeMessage("gameEvent", { event: ev }), {
					critical: false,
				});
			}

			for (const player of room.players.values()) {
				const snapshot = world.toSnapshot(player.lastProcessedSeq);
				for (const e of snapshot.entities) {
					if (e.kind === "ship") {
						const p = room.players.get(e.ownerId);
						e.ownerSlot = p?.ownerSlot ?? 0;
					}
				}

				if (player.codec === "json") {
					safeSend(player.socket, JSON.stringify(snapshot), {
						critical: false,
					});
				} else {
					const bin = encodeSnapshotBinary(snapshot);
					safeSend(player.socket, bin, { critical: false });
				}
			}
		});
	}

	wss.on("connection", (socket) => {
		const state = {
			id: randomUUID().slice(0, 8),
			player: null,
			room: null,
			tokens: 90,
			lastRefill: Date.now(),
		};

		socket.__missedPongs = 0;

		socket.on("error", (err) => {
			console.error(`[WS socket ${state.id} error]`, err.message);
		});

		socket.on("pong", () => {
			socket.__missedPongs = 0;
		});

		const joinDeadline = setTimeout(() => {
			if (!state.player && socket.readyState === WebSocket.OPEN) {
				socket.close(1008, "Join handshake timeout (5s)");
			}
		}, config.joinTimeoutMs);

		socket.on("message", (raw, isBinary) => {
			const now = Date.now();
			const elapsedSec = (now - state.lastRefill) / 1000;
			state.tokens = Math.min(90, state.tokens + elapsedSec * 60);
			state.lastRefill = now;

			if (state.tokens < 1) {
				socket.close(1008, "Rate limit exceeded");
				return;
			}
			state.tokens -= 1;

			const result = validateIncomingMessage(
				raw,
				isBinary,
				config.maxPayloadBytes,
			);
			if (!result.ok) {
				socket.close(result.code, result.reason);
				return;
			}

			const msg = result.msg;

			if (msg.type === "ping") {
				safeSend(
					socket,
					encodeMessage("pong", { clientTime: msg.clientTime, netSim }),
					{ critical: true },
				);
				return;
			}

			if (msg.type === "netSim") {
				netSim.latencyMs = msg.latencyMs;
				netSim.jitterMs = msg.jitterMs;
				netSim.dropRate = msg.dropRate;
				if (state.room) {
					broadcastRoom(
						state.room,
						encodeMessage("netSimUpdated", { netSim }),
						{ critical: true },
					);
				}
				return;
			}

			if (msg.type === "input") {
				if (!state.player || !state.room) return;
				deliverWithNetSim(
					() => {
						if (state.room && state.player) {
							state.room.enqueueInput(state.player.id, msg);
						}
					},
					{ bypassDrop: false },
				);
				return;
			}

			if (msg.type === "join") {
				if (state.player) {
					socket.close(1002, "Already joined a room");
					return;
				}

				let room = roomManager.getRoom(msg.room);
				if (!room) {
					try {
						room = roomManager.createRoom({ id: msg.room, name: msg.room });
					} catch (err) {
						socket.close(1013, err.message);
						return;
					}
				}

				hookRoomSnapshots(room);

				const joined = room.join({
					id: state.id,
					name: msg.name,
					codec: msg.codec,
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
					encodeMessage("welcome", {
						playerId: joined.id,
						ownerSlot: joined.ownerSlot,
						codec: joined.codec,
						room: room.toSummary(),
						players: room.getRoster(),
						netSim,
					}),
					{ critical: true, bypassNetSim: true },
				);

				broadcastRoom(
					room,
					encodeMessage("roster", {
						players: room.getRoster(),
						systemNotice: `${joined.name} joined the arena`,
					}),
					{ critical: true },
				);
				return;
			}

			if (msg.type === "chat") {
				if (!state.player || !state.room) {
					socket.close(1002, "Must join a room before chatting");
					return;
				}

				state.room.chat(state.player, msg.text);
				broadcastRoom(
					state.room,
					encodeMessage("chat", {
						playerId: state.player.id,
						name: state.player.name,
						text: msg.text,
					}),
					{ critical: true },
				);
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
					encodeMessage("roster", {
						players: room.getRoster(),
						systemNotice: `${player.name} left the arena`,
					}),
					{ critical: true },
				);
			}
		});
	});

	const heartbeat = setInterval(() => {
		for (const socket of wss.clients) {
			if (socket.readyState !== WebSocket.OPEN) continue;
			if (socket.__missedPongs >= 2) {
				socket.terminate();
				continue;
			}
			socket.__missedPongs += 1;
			socket.ping();
		}
	}, config.heartbeatIntervalMs);

	return {
		wss,
		async close() {
			clearInterval(heartbeat);
			for (const client of wss.clients) {
				client.close(1001, "Server shutting down");
			}
			await new Promise((resolve) => wss.close(() => resolve()));
		},
	};
}
