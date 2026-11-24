import { fetchJson } from "../assets/loader.js";

export class Lobby extends EventTarget {
	#rooms = [];
	#pollTimer = null;
	#inFlightController = null;
	#active = false;

	constructor({
		endpoint = "/api/rooms.json",
		pollIntervalMs = 4000,
		timeoutMs = 3000,
	} = {}) {
		super();
		this.endpoint = endpoint;
		this.pollIntervalMs = pollIntervalMs;
		this.timeoutMs = timeoutMs;
		this.selectedRoomId = null;
		this.playerName = "Andrii";
	}

	get rooms() {
		return [...this.#rooms];
	}

	start() {
		if (this.#active) return;
		this.#active = true;
		this.refresh();
		this.#pollTimer = setInterval(() => {
			if (this.#active) {
				this.refresh();
			}
		}, this.pollIntervalMs);
	}

	stop() {
		this.#active = false;
		if (this.#pollTimer !== null) {
			clearInterval(this.#pollTimer);
			this.#pollTimer = null;
		}
		if (this.#inFlightController) {
			this.#inFlightController.abort(
				new DOMException("Player left lobby", "AbortError"),
			);
			this.#inFlightController = null;
		}
	}

	async refresh() {
		if (!this.#active) return;

		if (this.#inFlightController) {
			this.#inFlightController.abort(
				new DOMException("Superseded by newer refresh", "AbortError"),
			);
		}

		const controller = new AbortController();
		this.#inFlightController = controller;
		const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
		const combinedSignal = AbortSignal.any([controller.signal, timeoutSignal]);

		this.dispatchEvent(
			new CustomEvent("status", { detail: { loading: true, error: null } }),
		);

		try {
			const data = await fetchJson(this.endpoint, { signal: combinedSignal });
			if (!this.#active) return;

			this.#rooms = Array.isArray(data) ? data : [];
			if (!this.selectedRoomId && this.#rooms.length > 0) {
				this.selectedRoomId = this.#rooms[0].id;
			}

			this.dispatchEvent(
				new CustomEvent("roomsChanged", {
					detail: {
						rooms: this.rooms,
						updatedAt: new Date().toLocaleTimeString(),
					},
				}),
			);
			this.dispatchEvent(
				new CustomEvent("status", { detail: { loading: false, error: null } }),
			);
		} catch (err) {
			if (err.name === "AbortError" && !this.#active) {
				return;
			}
			const message =
				err.name === "TimeoutError"
					? `Server timeout (${this.timeoutMs} ms)`
					: (err.message ?? "Failed to load rooms");
			this.dispatchEvent(
				new CustomEvent("status", {
					detail: { loading: false, error: message },
				}),
			);
		} finally {
			if (this.#inFlightController === controller) {
				this.#inFlightController = null;
			}
		}
	}

	join(roomId = this.selectedRoomId, playerName = this.playerName) {
		const room = this.#rooms.find((r) => r.id === roomId) ??
			this.#rooms[0] ?? {
				id: "offline-arena",
				name: "Offline Proving Ground",
				initialAsteroids: 5,
				seekerRatio: 3,
			};

		const cleanName = (playerName ?? "").trim() || "Commander";
		this.stop();

		this.dispatchEvent(
			new CustomEvent("join", {
				detail: {
					room: {
						...room,
						playerName: cleanName,
					},
				},
			}),
		);
	}
}
