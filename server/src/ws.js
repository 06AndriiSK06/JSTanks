import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { encodeMessage, validateIncomingMessage } from "./protocol.js";

export function attachWebSocketServer({ server, roomManager, config }) {
	const wss = new WebSocketServer({
		server,
		path: "/ws",
		maxPayload: config.maxPayloadBytes,
	});

	wss.on("error", (err) => {
		console.error("[WSS error]", err);
	});

	function safeSend(socket, data, { critical = true } = {}) {
		if (socket.readyState !== WebSocket.OPEN) return false;

		// Політика повільного клієнта (backpressure): не переповнюємо буфер некритичними повідомленнями
		if (!critical && socket.bufferedAmount > config.bufferedAmountLimitBytes) {
			return false;
		}

		if (socket.bufferedAmount > config.bufferedAmountLimitBytes * 4) {
			socket.close(1008, "Client too slow (send buffer overflow)");
			return false;
		}

		socket.send(data);
		return true;
	}

	function broadcastRoom(room, payload, { critical = true } = {}) {
		for (const player of room.players.values()) {
			safeSend(player.socket, payload, { critical });
		}
	}

	wss.on("connection", (socket) => {
		const state = {
			id: randomUUID().slice(0, 8),
			player: null,
			room: null,
			missedPongs: 0,
			tokens: config.rateLimitPerSec,
			lastRefill: Date.now(),
		};

		socket.on("error", (err) => {
			console.error(`[WS socket ${state.id} error]`, err.message);
		});

		socket.on("pong", () => {
			state.missedPongs = 0;
		});

		// Клієнт повинен надіслати join протягом 5 секунд
		const joinDeadline = setTimeout(() => {
			if (!state.player && socket.readyState === WebSocket.OPEN) {
				socket.close(1008, "Join handshake timeout (5s)");
			}
		}, config.joinTimeoutMs);

		socket.on("message", (raw) => {
			// Token-bucket rate limiter
			const now = Date.now();
			const elapsedSec = (now - state.lastRefill) / 1000;
			state.tokens = Math.min(
				config.rateLimitPerSec,
				state.tokens + elapsedSec * config.rateLimitPerSec,
			);
			state.lastRefill = now;

			if (state.tokens < 1) {
				socket.close(1008, "Rate limit exceeded");
				return;
			}
			state.tokens -= 1;

			const result = validateIncomingMessage(raw, config.maxPayloadBytes);
			if (!result.ok) {
				socket.close(result.code, result.reason);
				return;
			}

			const msg = result.msg;

			if (msg.type === "ping") {
				safeSend(socket, encodeMessage("pong"), { critical: false });
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

				const player = {
					id: state.id,
					name: msg.name,
					joinedAt: Date.now(),
					socket,
				};

				if (!room.join(player)) {
					socket.close(1013, "Room is full");
					return;
				}

				clearTimeout(joinDeadline);
				state.player = player;
				state.room = room;

				safeSend(
					socket,
					encodeMessage("welcome", {
						playerId: player.id,
						room: room.toSummary(),
						players: room.getRoster(),
					}),
					{ critical: true },
				);

				broadcastRoom(
					room,
					encodeMessage("roster", {
						players: room.getRoster(),
						systemNotice: `${player.name} joined the arena`,
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
					{ critical: false },
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

	// Heartbeat ping кожні 15 с; розрив після 2 пропущених pong
	const heartbeat = setInterval(() => {
		for (const socket of wss.clients) {
			if (socket.readyState !== WebSocket.OPEN) continue;
			if (socket.__missedPongs === undefined) socket.__missedPongs = 0;

			if (socket.__missedPongs >= 2) {
				socket.terminate();
				continue;
			}
			socket.__missedPongs += 1;
			socket.ping();
		}
	}, config.heartbeatIntervalMs);

	wss.on("connection", (socket) => {
		socket.__missedPongs = 0;
		socket.on("pong", () => {
			socket.__missedPongs = 0;
		});
	});

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
