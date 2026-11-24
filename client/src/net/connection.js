export class GameConnection extends EventTarget {
	#ws = null;
	#sendQueue = [];
	#reconnectAttempts = 0;
	#reconnectTimer = null;
	#manualClose = false;
	#joinPayload = null;

	constructor({ url = null, maxReconnectDelayMs = 8000 } = {}) {
		super();
		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		this.url = url ?? `${proto}//${window.location.host}/ws`;
		this.maxReconnectDelayMs = maxReconnectDelayMs;
	}

	get isOpen() {
		return this.#ws?.readyState === WebSocket.OPEN;
	}

	connect(joinPayload) {
		this.#joinPayload = joinPayload;
		this.#manualClose = false;
		this.#openSocket();
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
		this.#ws = ws;

		ws.addEventListener("open", () => {
			this.#reconnectAttempts = 0;
			this.dispatchEvent(new CustomEvent("connected"));

			if (this.#joinPayload) {
				ws.send(JSON.stringify({ v: 1, type: "join", ...this.#joinPayload }));
			}

			while (this.#sendQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
				const queued = this.#sendQueue.shift();
				ws.send(queued);
			}
		});

		ws.addEventListener("message", (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg && typeof msg.type === "string") {
					this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
				}
			} catch (err) {
				console.warn("[GameConnection] Failed to parse WS message:", err);
			}
		});

		ws.addEventListener("close", (event) => {
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

	send(type, payload = {}) {
		const raw = JSON.stringify({ v: 1, type, ...payload });
		if (this.isOpen) {
			this.#ws.send(raw);
		} else {
			if (this.#sendQueue.length >= 50) {
				this.#sendQueue.shift();
			}
			this.#sendQueue.push(raw);
		}
	}

	close() {
		this.#manualClose = true;
		if (this.#reconnectTimer !== null) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
		this.#sendQueue.length = 0;
		if (this.#ws) {
			this.#ws.close(1000, "Client leaving");
			this.#ws = null;
		}
	}
}
