import { decodeSnapshotBinary, encodeInputBinary } from "@jstanks/shared";

export class GameConnection extends EventTarget {
	#ws = null;
	#sendQueue = [];
	#reconnectAttempts = 0;
	#reconnectTimer = null;
	#pingTimer = null;
	#statsTimer = null;
	#manualClose = false;
	#joinPayload = null;
	#bytesInAcc = 0;
	#bytesOutAcc = 0;

	constructor({
		url = null,
		codec = "binary",
		maxReconnectDelayMs = 8000,
	} = {}) {
		super();
		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		this.url = url ?? `${proto}//${window.location.host}/ws`;
		this.codec = codec === "json" ? "json" : "binary";
		this.maxReconnectDelayMs = maxReconnectDelayMs;
		this.rttMs = 0;
		this.bytesInPerSec = 0;
		this.bytesOutPerSec = 0;
	}

	get isOpen() {
		return this.#ws?.readyState === WebSocket.OPEN;
	}

	connect(joinPayload) {
		this.#joinPayload = { ...joinPayload, codec: this.codec };
		this.#manualClose = false;
		this.#openSocket();

		if (this.#statsTimer === null) {
			this.#statsTimer = setInterval(() => {
				this.bytesInPerSec = this.#bytesInAcc;
				this.bytesOutPerSec = this.#bytesOutAcc;
				this.#bytesInAcc = 0;
				this.#bytesOutAcc = 0;
			}, 1000);
		}
	}

	#sendRaw(payload) {
		const size =
			payload instanceof ArrayBuffer
				? payload.byteLength
				: new TextEncoder().encode(String(payload)).byteLength;

		if (this.isOpen) {
			this.#bytesOutAcc += size;
			this.#ws.send(payload);
		} else {
			if (this.#sendQueue.length >= 60) {
				this.#sendQueue.shift();
			}
			this.#sendQueue.push(payload);
		}
	}

	#openSocket() {
		if (
			this.#ws &&
			(this.#ws.readyState === WebSocket.OPEN ||
				this.#ws.readyState === WebSocket.CONNECTING)
		) {
			return;
		}

		const ws = new WebSocket(this.url);
		ws.binaryType = "arraybuffer";
		this.#ws = ws;

		ws.addEventListener("open", () => {
			this.#reconnectAttempts = 0;
			this.dispatchEvent(new CustomEvent("connected"));

			if (this.#joinPayload) {
				this.#sendRaw(
					JSON.stringify({ v: 1, type: "join", ...this.#joinPayload }),
				);
			}

			while (this.#sendQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
				const queued = this.#sendQueue.shift();
				this.#sendRaw(queued);
			}

			if (this.#pingTimer !== null) clearInterval(this.#pingTimer);
			this.#pingTimer = setInterval(() => {
				if (this.isOpen) {
					this.#sendRaw(
						JSON.stringify({
							v: 1,
							type: "ping",
							clientTime: performance.now(),
						}),
					);
				}
			}, 1000);
		});

		ws.addEventListener("message", (event) => {
			if (event.data instanceof ArrayBuffer) {
				this.#bytesInAcc += event.data.byteLength;
				try {
					const snapshot = decodeSnapshotBinary(event.data);
					this.dispatchEvent(new CustomEvent("snapshot", { detail: snapshot }));
				} catch (err) {
					console.warn("[GameConnection] Binary decode error:", err);
				}
				return;
			}

			const text = String(event.data);
			this.#bytesInAcc += new TextEncoder().encode(text).byteLength;
			try {
				const msg = JSON.parse(text);
				if (msg?.type === "pong") {
					const sentAt = Number(msg.clientTime);
					if (sentAt > 0) {
						const sample = Math.max(0, performance.now() - sentAt);
						this.rttMs =
							this.rttMs === 0 ? sample : this.rttMs * 0.7 + sample * 0.3;
					}
					this.dispatchEvent(new CustomEvent("pong", { detail: msg }));
					return;
				}
				if (msg && typeof msg.type === "string") {
					this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
				}
			} catch (err) {
				console.warn("[GameConnection] JSON parse error:", err);
			}
		});

		ws.addEventListener("close", (event) => {
			if (this.#pingTimer !== null) {
				clearInterval(this.#pingTimer);
				this.#pingTimer = null;
			}
			this.dispatchEvent(
				new CustomEvent("disconnected", {
					detail: { code: event.code, reason: event.reason },
				}),
			);
			if (!this.#manualClose) {
				this.#scheduleReconnect();
			}
		});

		ws.addEventListener("error", () => {
			this.dispatchEvent(new CustomEvent("socketError"));
		});
	}

	#scheduleReconnect() {
		if (this.#reconnectTimer !== null) return;
		const delay = Math.min(
			this.maxReconnectDelayMs,
			300 * 2 ** this.#reconnectAttempts + Math.round(Math.random() * 200),
		);
		this.#reconnectAttempts += 1;

		this.dispatchEvent(
			new CustomEvent("reconnecting", {
				detail: { attempt: this.#reconnectAttempts, delayMs: delay },
			}),
		);

		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			if (!this.#manualClose) {
				this.#openSocket();
			}
		}, delay);
	}

	sendInput(input) {
		if (this.codec === "binary") {
			this.#sendRaw(encodeInputBinary(input));
		} else {
			this.#sendRaw(JSON.stringify({ v: 1, type: "input", ...input }));
		}
	}

	send(type, payload = {}) {
		this.#sendRaw(JSON.stringify({ v: 1, type, ...payload }));
	}

	close() {
		this.#manualClose = true;
		if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
		if (this.#pingTimer !== null) clearInterval(this.#pingTimer);
		if (this.#statsTimer !== null) clearInterval(this.#statsTimer);
		this.#sendQueue.length = 0;
		if (this.#ws) {
			this.#ws.close(1000, "Client leaving");
			this.#ws = null;
		}
	}
}
