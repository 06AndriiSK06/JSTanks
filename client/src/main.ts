import { fetchJson, type LoadedAssets, loadAll } from "./assets/loader.js";
import { createAudioEngine } from "./audio/audio.js";
import { createInput } from "./input.js";
import { mountRoomChatView } from "./lobby/chatView.js";
import { Lobby, type SelectedRoomConfig } from "./lobby/lobby.js";
import { mountLobbyView } from "./lobby/lobbyView.js";
import { createLoop } from "./loop.js";
import { GameConnection } from "./net/connection.js";
import { mountNetgraphView } from "./net/netgraph.js";
import { NetworkSession } from "./net/predictor.js";
import { setupCanvas } from "./render/canvas.js";
import {
	createHudRenderer,
	drawLoadingScreen,
	drawMultiplayerWorld,
	type LoadingScreenState,
} from "./render/draw.js";
import { ParticleSystem } from "./render/particles.js";

const canvasEl = document.getElementById("game");
if (!(canvasEl instanceof HTMLCanvasElement)) {
	throw new Error("Missing #game canvas element");
}
const canvas = canvasEl;

const viewportArena = { width: window.innerWidth, height: window.innerHeight };
const { ctx } = setupCanvas(canvas, (width, height) => {
	viewportArena.width = width;
	viewportArena.height = height;
});

const params = new URLSearchParams(window.location.search);
const failMode = params.get("fail");
const sequentialMode = params.get("mode") === "seq";
const codecMode = params.get("codec") === "json" ? "json" : "binary";

const audio = createAudioEngine();
const hud = createHudRenderer();
const particles = new ParticleSystem();
const connection = new GameConnection({ codec: codecMode });
const session = new NetworkSession({ arenaWidth: 1200, arenaHeight: 760 });
const chatView = mountRoomChatView(connection);

let currentRoomId = "training-range";
let currentRoomName = "Arena";

const netgraphView = mountNetgraphView({
	connection,
	session,
	particles,
	getRoomId: () => currentRoomId,
});

const loadingState: LoadingScreenState = {
	done: 0,
	total: 6,
	ratio: 0,
	label: "Loading manifest...",
	error: null,
	elapsedMs: null,
	mode: sequentialMode ? "sequential" : "concurrent",
};

let screenMode: "loading" | "lobby" | "playing" = "loading";
let loadedAssets: LoadedAssets | null = null;
const rawInput = createInput(window);

function toAxis(pos: boolean, neg: boolean): -1 | 0 | 1 {
	if (pos && !neg) return 1;
	if (neg && !pos) return -1;
	return 0;
}

function readControls(): {
	thrust: -1 | 0 | 1;
	turn: -1 | 0 | 1;
	fire: boolean;
	missile: boolean;
} {
	if (chatView.isTyping()) {
		return { thrust: 0, turn: 0, fire: false, missile: false };
	}
	const forward = rawInput.isDown("KeyW") || rawInput.isDown("ArrowUp");
	const backward = rawInput.isDown("KeyS") || rawInput.isDown("ArrowDown");
	const left = rawInput.isDown("KeyA") || rawInput.isDown("ArrowLeft");
	const right = rawInput.isDown("KeyD") || rawInput.isDown("ArrowRight");

	return {
		thrust: toAxis(forward, backward),
		turn: toAxis(right, left),
		fire: rawInput.isDown("Space") || rawInput.isDown("KeyF"),
		missile: rawInput.justPressed("KeyE") || rawInput.justPressed("ShiftLeft"),
	};
}

connection.on("welcome", (detail) => {
	session.setIdentity({
		playerId: detail.playerId,
		ownerSlot: detail.ownerSlot,
		roster: detail.players,
		arena: detail.room.arena,
	});
});

connection.on("roster", (detail) => {
	session.updateRoster(detail.players);
});

connection.on("snapshot", (snap) => {
	performance.mark("reconcile:start");
	session.onSnapshot(snap);
	performance.mark("reconcile:end");
	performance.measure("reconcile", "reconcile:start", "reconcile:end");
});

connection.on("gameEvent", (detail) => {
	const ev = detail.event;
	switch (ev.type) {
		case "fired":
			audio.play("shoot", {
				volume: ev.isMissile ? 0.75 : 0.45,
				rate: ev.isMissile ? 0.75 : 1.05,
			});
			break;
		case "hit":
			audio.play("hit", { volume: 0.45 });
			break;
		case "exploded":
			audio.play("explosion", { volume: ev.kind === "ship" ? 0.9 : 0.65 });
			particles.spawnExplosion(ev.x, ev.y, ev.kind === "ship" ? 28 : 16);
			break;
		case "pickup":
			audio.play("pickup", { volume: 0.6 });
			break;
		default: {
			const _exhaustive: never = ev;
			return _exhaustive;
		}
	}
});

function startMultiplayerBattle(roomConfig: SelectedRoomConfig): void {
	currentRoomId = roomConfig.id;
	currentRoomName = roomConfig.name;
	chatView.show();
	netgraphView.show();

	connection.connect({
		room: roomConfig.id,
		name: roomConfig.playerName,
	});

	screenMode = "playing";
}

function openLobby(): void {
	screenMode = "lobby";
	const lobbyEndpoint =
		failMode === "json" ? "/assets/sprites.svg" : "/api/rooms";
	const lobby = new Lobby({
		endpoint: lobbyEndpoint,
		pollIntervalMs: 3500,
		timeoutMs: 3000,
	});
	const view = mountLobbyView(lobby);

	lobby.on("join", (detail) => {
		startMultiplayerBattle(detail.room);
	});

	view.show();
	lobby.start();
}

async function runAssetPipeline(): Promise<void> {
	loadingState.error = null;
	loadingState.ratio = 0;
	loadingState.done = 0;
	loadingState.label = "Fetching /assets/manifest.json...";

	const controller = new AbortController();
	const timeoutSignal = AbortSignal.timeout(failMode === "timeout" ? 1 : 8000);
	const signal = AbortSignal.any([controller.signal, timeoutSignal]);

	if (failMode === "abort") {
		setTimeout(() => {
			controller.abort(
				new DOMException("User cancelled asset loading", "AbortError"),
			);
		}, 30);
	}

	try {
		const manifestUrl =
			failMode === "json" ? "/index.html" : "/assets/manifest.json";
		const manifest = await fetchJson<unknown>(manifestUrl, { signal });

		if (
			failMode === "404" &&
			typeof manifest === "object" &&
			manifest !== null &&
			"sprites" in manifest
		) {
			const sprites = (manifest as { sprites?: { sheet?: string } }).sprites; // діагностична підміна URL для тесту 404
			if (sprites) {
				sprites.sheet = "/assets/nonexistent-tank-sheet-404.png";
			}
		}

		loadedAssets = await loadAll(manifest, {
			audioCtx: audio.ctx,
			signal,
			sequential: sequentialMode,
			onProgress(progress) {
				loadingState.done = progress.done;
				loadingState.total = progress.total;
				loadingState.ratio = progress.ratio;
				loadingState.label = progress.label;
			},
		});

		loadingState.elapsedMs = loadedAssets.elapsedMs;
		audio.setBuffers(loadedAssets.sounds);

		await new Promise<void>((r) => setTimeout(r, 250));
		openLobby();
	} catch (err: unknown) {
		console.error("[AssetPipeline Failure]", err);
		if (err instanceof Error) {
			loadingState.error = `${err.name}: ${err.message}`;
		} else {
			loadingState.error = String(err);
		}
	}
}

window.addEventListener("keydown", (e: KeyboardEvent) => {
	if (e.code === "KeyM" && screenMode === "playing" && !chatView.isTyping()) {
		audio.toggleMute();
	}
	if (screenMode === "loading" && loadingState.error) {
		if (e.code === "KeyR") {
			window.history.replaceState({}, "", window.location.pathname);
			void runAssetPipeline();
		} else if (e.code === "Enter") {
			openLobby();
		}
	}
});

canvas.addEventListener("click", () => {
	if (screenMode === "loading" && loadingState.error) {
		window.history.replaceState({}, "", window.location.pathname);
		void runAssetPipeline();
	}
});

const loop = createLoop({
	step: 1 / 30,
	simulate(dt) {
		performance.mark("simulate:start");
		if (screenMode === "playing") {
			const controls = readControls();
			const inputPacket = session.stepLocalPrediction(dt, controls);
			connection.sendInput(inputPacket);
			particles.step(dt);
		}
		rawInput.endStep();
		performance.mark("simulate:end");
		performance.measure("simulate", "simulate:start", "simulate:end");
	},
	render() {
		const t0 = performance.now();
		performance.mark("render:start");
		if (screenMode === "loading") {
			drawLoadingScreen(ctx, viewportArena, loadingState);
		} else if (screenMode === "playing") {
			const entities = session.getRenderEntities();
			drawMultiplayerWorld(
				ctx,
				viewportArena,
				session.arena,
				entities,
				loadedAssets,
			);
			const offsetX = Math.floor(
				(viewportArena.width - session.arena.width) / 2,
			);
			const offsetY = Math.floor(
				(viewportArena.height - session.arena.height) / 2,
			);
			particles.draw(ctx, offsetX, offsetY);
			hud.draw(ctx, loop.getStats(), currentRoomName, session.localShip, audio);
		}
		performance.mark("render:end");
		performance.measure("render", "render:start", "render:end");
		netgraphView.recordFrameMs(performance.now() - t0);
	},
});

loop.start();
void runAssetPipeline();
