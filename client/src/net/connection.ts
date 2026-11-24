import {
	decodeSnapshotBinary,
	encodeInputBinary,
	type PlayerInputCommand,
	type RoomSummaryInfo,
	type RosterPlayerInfo,
	type SimGameEvent,
	type WorldSnapshot,
} from "@jstanks/shared";
import { Bus } from "../bus.js";

export interface ConnectionEvents extends Record<string, unknown> {
	connected: undefined;
	disconnected: { readonly code: number; readonly reason: string };
	reconnecting: { readonly attempt: number; readonly delayMs: number };
	welcome: {
		readonly playerId: string;
		readonly ownerSlot: number;
		readonly codec: "binary" | "json";
		readonly room: RoomSummaryInfo;
		readonly players: readonly RosterPlayerInfo[];
	};
	roster: {
		readonly players: readonly RosterPlayerInfo[];
		readonly systemNotice?: string;
	};
	chat: {
		readonly playerId: string;
		readonly name: string;
		readonly text: string;
	};
	snapshot: WorldSnapshot;
	gameEvent: { readonly event: SimGameEvent };
}

export class GameConnection extends Bus<ConnectionEvents> {
	private ws: WebSocket | null = null;
	private readonly sendQueue: Array<string | ArrayBuffer> = [];
	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private statsTimer: ReturnType<typeof setInterval> | null = null;
	private manualClose = false;
	private joinPayload: {
		room: string;
		name: string;
		codec: "binary" | "json";
	} | null = null;
	private bytesInAcc = 0;
	private bytesOutAcc = 0;

	readonly url: string;
	readonly codec: "binary" | "json";
	readonly maxReconnectDelayMs: number;
	rttMs = 0;
	bytesInPerSec = 0;
	bytesOutPerSec = 0;

	constructor(
		options: {
			url?: string;
			codec?: "binary" | "json";
			maxReconnectDelayMs?: number;
		} = {},
	) {
		super();
		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		this.url = options.url ?? `${proto}//${window.location.host}/ws`;
		this.codec = options.codec === "json" ? "json" : "binary";
		this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 8000;
	}

	get isOpen(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	connect(joinPayload: { room: string; name: string }): void {
		this.joinPayload = { ...joinPayload, codec: this.codec };
		this.manualClose = false;
		this.openSocket();

		if (this.statsTimer === null) {
			this.statsTimer = setInterval(() => {
				this.bytesInPerSec = this.bytesInAcc;
				this.bytesOutPerSec = this.bytesOutAcc;
				this.bytesInAcc = 0;
				this.bytesOutAcc = 0;
			}, 1000);
		}
	}

	private sendRaw(payload: string | ArrayBuffer): void {
		const size =
			payload instanceof ArrayBuffer
				? payload.byteLength
				: new TextEncoder().encode(payload).byteLength;

		if (this.isOpen && this.ws) {
			this.bytesOutAcc += size;
			this.ws.send(payload);
		} else {
			if (this.sendQueue.length >= 60) {
				this.sendQueue.shift();
			}
			this.sendQueue.push(payload);
		}
	}

	private openSocket(): void {
		if (
			this.ws &&
			(this.ws.readyState === WebSocket.OPEN ||
				this.ws.readyState === WebSocket.CONNECTING)
		) {
			return;
		}

		const ws = new WebSocket(this.url);
		ws.binaryType = "arraybuffer";
		this.ws = ws;

		ws.addEventListener("open", () => {
			this.reconnectAttempts = 0;
			this.emit("connected", undefined);

			if (this.joinPayload) {
				this.sendRaw(
					JSON.stringify({ v: 1, type: "join", ...this.joinPayload }),
				);
			}

			while (this.sendQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
				const queued = this.sendQueue.shift();
				if (queued !== undefined) {
					this.sendRaw(queued);
				}
			}

			if (this.pingTimer !== null) clearInterval(this.pingTimer);
			this.pingTimer = setInterval(() => {
				if (this.isOpen) {
					this.sendRaw(
						JSON.stringify({
							v: 1,
							type: "ping",
							clientTime: performance.now(),
						}),
					);
				}
			}, 1000);
		});

		ws.addEventListener("message", (event: MessageEvent<unknown>) => {
			if (event.data instanceof ArrayBuffer) {
				this.bytesInAcc += event.data.byteLength;
				try {
					const snapshot = decodeSnapshotBinary(event.data);
					this.emit("snapshot", snapshot);
				} catch (err: unknown) {
					console.warn("[GameConnection] Binary decode error:", err);
				}
				return;
			}

			const text = String(event.data);
			this.bytesInAcc += new TextEncoder().encode(text).byteLength;
			try {
				const msg = JSON.parse(text) as Record<string, unknown>;
				if (msg.type === "pong") {
					const sentAt = Number(msg.clientTime);
					if (sentAt > 0) {
						const sample = Math.max(0, performance.now() - sentAt);
						this.rttMs =
							this.rttMs === 0 ? sample : this.rttMs * 0.7 + sample * 0.3;
					}
					return;
				}
				if (msg.type === "snapshot") {
					this.emit("snapshot", msg as unknown as WorldSnapshot); // JSON-режим діагностики знімків
					return;
				}
				if (msg.type === "welcome") {
					this.emit("welcome", msg as unknown as ConnectionEvents["welcome"]); // серверний welcome-пакет
					return;
				}
				if (msg.type === "roster") {
					this.emit("roster", msg as unknown as ConnectionEvents["roster"]); // оновлення списку гравців
					return;
				}
				if (msg.type === "chat") {
					this.emit("chat", msg as unknown as ConnectionEvents["chat"]); // вхідне повідомлення чату
					return;
				}
				if (msg.type === "gameEvent") {
					this.emit(
						"gameEvent",
						msg as unknown as ConnectionEvents["gameEvent"],
					); // ігрова подія для звуку
				}
			} catch (err: unknown) {
				console.warn("[GameConnection] JSON parse error:", err);
			}
		});

		ws.addEventListener("close", (event: CloseEvent) => {
			if (this.pingTimer !== null) {
				clearInterval(this.pingTimer);
				this.pingTimer = null;
			}
			this.emit("disconnected", { code: event.code, reason: event.reason });
			if (!this.manualClose) {
				this.scheduleReconnect();
			}
		});
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer !== null) return;
		const delay = Math.min(
			this.maxReconnectDelayMs,
			300 * 2 ** this.reconnectAttempts + Math.round(Math.random() * 200),
		);
		this.reconnectAttempts += 1;

		this.emit("reconnecting", {
			attempt: this.reconnectAttempts,
			delayMs: delay,
		});

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (!this.manualClose) {
				this.openSocket();
			}
		}, delay);
	}

	sendInput(input: PlayerInputCommand): void {
		if (this.codec === "binary") {
			this.sendRaw(encodeInputBinary(input));
		} else {
			this.sendRaw(JSON.stringify({ v: 1, type: "input", ...input }));
		}
	}

	send(type: string, payload: Record<string, unknown> = {}): void {
		this.sendRaw(JSON.stringify({ v: 1, type, ...payload }));
	}

	close(): void {
		this.manualClose = true;
		if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
		if (this.pingTimer !== null) clearInterval(this.pingTimer);
		if (this.statsTimer !== null) clearInterval(this.statsTimer);
		this.sendQueue.length = 0;
		if (this.ws) {
			this.ws.close(1000, "Client leaving");
			this.ws = null;
		}
	}
}
