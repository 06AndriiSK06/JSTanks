import type { RoomSummaryInfo } from "@jstanks/shared";
import { fetchJson } from "../assets/loader.js";
import { Bus } from "../bus.js";

export interface SelectedRoomConfig extends RoomSummaryInfo {
	readonly playerName: string;
}

export interface LobbyEvents extends Record<string, unknown> {
	roomsChanged: {
		readonly rooms: readonly RoomSummaryInfo[];
		readonly updatedAt: string;
	};
	status: { readonly loading: boolean; readonly error: string | null };
	join: { readonly room: SelectedRoomConfig };
}

export class Lobby extends Bus<LobbyEvents> {
	private roomList: RoomSummaryInfo[] = [];
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private inFlightController: AbortController | null = null;
	private active = false;

	readonly endpoint: string;
	readonly pollIntervalMs: number;
	readonly timeoutMs: number;
	selectedRoomId: string | null = null;
	playerName = "Andrii";

	constructor(
		options: {
			endpoint?: string;
			pollIntervalMs?: number;
			timeoutMs?: number;
		} = {},
	) {
		super();
		this.endpoint = options.endpoint ?? "/api/rooms";
		this.pollIntervalMs = options.pollIntervalMs ?? 3500;
		this.timeoutMs = options.timeoutMs ?? 3000;
	}

	get rooms(): readonly RoomSummaryInfo[] {
		return [...this.roomList];
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		void this.refresh();
		this.pollTimer = setInterval(() => {
			if (this.active) {
				void this.refresh();
			}
		}, this.pollIntervalMs);
	}

	stop(): void {
		this.active = false;
		if (this.pollTimer !== null) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.inFlightController) {
			this.inFlightController.abort(
				new DOMException("Player left lobby", "AbortError"),
			);
			this.inFlightController = null;
		}
	}

	async refresh(): Promise<void> {
		if (!this.active) return;

		if (this.inFlightController) {
			this.inFlightController.abort(
				new DOMException("Superseded by newer refresh", "AbortError"),
			);
		}

		const controller = new AbortController();
		this.inFlightController = controller;
		const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
		const combinedSignal = AbortSignal.any([controller.signal, timeoutSignal]);

		this.emit("status", { loading: true, error: null });

		try {
			const data = await fetchJson<RoomSummaryInfo[]>(this.endpoint, {
				signal: combinedSignal,
			});
			if (!this.active) return;

			this.roomList = Array.isArray(data) ? data : [];
			const firstRoom = this.roomList[0];
			if (!this.selectedRoomId && firstRoom) {
				this.selectedRoomId = firstRoom.id;
			}

			this.emit("roomsChanged", {
				rooms: this.rooms,
				updatedAt: new Date().toLocaleTimeString(),
			});
			this.emit("status", { loading: false, error: null });
		} catch (err: unknown) {
			if (
				err instanceof DOMException &&
				err.name === "AbortError" &&
				!this.active
			) {
				return;
			}
			const message =
				err instanceof DOMException && err.name === "TimeoutError"
					? `Server timeout (${this.timeoutMs} ms)`
					: err instanceof Error
						? err.message
						: "Failed to load rooms";
			this.emit("status", { loading: false, error: message });
		} finally {
			if (this.inFlightController === controller) {
				this.inFlightController = null;
			}
		}
	}

	async createRoom(params: {
		name: string;
		difficulty?: "Normal" | "Hard" | "Insane";
		initialAsteroids?: number;
	}): Promise<RoomSummaryInfo> {
		const res = await fetch(this.endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(params),
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		const body = (await res.json()) as RoomSummaryInfo & { error?: string };
		if (!res.ok) {
			throw new Error(body.error ?? `HTTP ${res.status}`);
		}
		this.selectedRoomId = body.id;
		await this.refresh();
		return body;
	}

	join(
		roomId: string | null = this.selectedRoomId,
		playerName: string = this.playerName,
	): void {
		const found =
			this.roomList.find((r) => r.id === roomId) ?? this.roomList[0];
		const fallback: RoomSummaryInfo = found ?? {
			id: "training-range",
			name: "Training Range (Standard)",
			players: 0,
			maxPlayers: 8,
			initialAsteroids: 5,
			difficulty: "Normal",
			seed: 42,
			arena: { width: 1200, height: 760 },
		};

		const cleanName = playerName.trim() || "Commander";
		this.stop();

		this.emit("join", {
			room: {
				...fallback,
				playerName: cleanName,
			},
		});
	}
}
