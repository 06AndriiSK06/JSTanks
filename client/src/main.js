import { fetchJson, loadAll } from "./assets/loader.js";
import { createAudioEngine } from "./audio/audio.js";
import { createInput } from "./input.js";
import { mountRoomChatView } from "./lobby/chatView.js";
import { Lobby } from "./lobby/lobby.js";
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
} from "./render/draw.js";
import { createArena } from "./sim/arena.js";

const canvas = document.getElementById("game");
const arena = createArena(window.innerWidth, window.innerHeight);

const { ctx } = setupCanvas(canvas, (width, height) => {
	arena.width = width;
	arena.height = height;
});

const params = new URLSearchParams(window.location.search);
const failMode = params.get("fail");
const sequentialMode = params.get("mode") === "seq";
const codecMode = params.get("codec") === "json" ? "json" : "binary";

const audio = createAudioEngine();
const hud = createHudRenderer();
const connection = new GameConnection({ codec: codecMode });
const session = new NetworkSession({ arenaWidth: 1200, arenaHeight: 760 });
const chatView = mountRoomChatView(connection);
const netgraphView = mountNetgraphView({ connection, session });

const loadingState = {
	done: 0,
	total: 6,
	ratio: 0,
	label: "Loading manifest...",
	error: null,
	elapsedMs: null,
	mode: sequentialMode ? "sequential" : "concurrent",
};

let screenMode = "loading";
let loadedAssets = null;
let currentRoomName = "Arena";
const rawInput = createInput(window);

function readControls() {
	if (chatView.isTyping()) {
		return { thrust: 0, turn: 0, fire: false, missile: false };
	}
	const forward = rawInput.isDown("KeyW") || rawInput.isDown("ArrowUp") ? 1 : 0;
	const backward =
		rawInput.isDown("KeyS") || rawInput.isDown("ArrowDown") ? 1 : 0;
	const left = rawInput.isDown("KeyA") || rawInput.isDown("ArrowLeft") ? 1 : 0;
	const right =
		rawInput.isDown("KeyD") || rawInput.isDown("ArrowRight") ? 1 : 0;

	return {
		thrust: forward - backward,
		turn: right - left,
		fire: rawInput.isDown("Space") || rawInput.isDown("KeyF"),
		missile: rawInput.justPressed("KeyE") || rawInput.justPressed("ShiftLeft"),
	};
}

connection.addEventListener("welcome", (e) => {
	session.setIdentity({
		playerId: e.detail.playerId,
		ownerSlot: e.detail.ownerSlot,
		roster: e.detail.players,
		arena: e.detail.room?.arena,
	});
});

connection.addEventListener("roster", (e) => {
	session.updateRoster(e.detail.players);
});

connection.addEventListener("snapshot", (e) => {
	session.onSnapshot(e.detail);
});

connection.addEventListener("gameEvent", (e) => {
	const ev = e.detail.event;
	if (!ev) return;
	if (ev.type === "fired") {
		audio.play("shoot", {
			volume: ev.isMissile ? 0.75 : 0.45,
			rate: ev.isMissile ? 0.75 : 1.05,
		});
	} else if (ev.type === "hit") {
		audio.play("hit", { volume: 0.45 });
	} else if (ev.type === "exploded") {
		audio.play("explosion", { volume: ev.kind === "ship" ? 0.9 : 0.65 });
	} else if (ev.type === "pickup") {
		audio.play("pickup", { volume: 0.6 });
	}
});

function startMultiplayerBattle(roomConfig) {
	currentRoomName = roomConfig.name ?? "Arena";
	chatView.show();
	netgraphView.show();

	connection.connect({
		room: roomConfig.id,
		name: roomConfig.playerName,
	});

	screenMode = "playing";
}

function openLobby() {
	screenMode = "lobby";
	const lobbyEndpoint =
		failMode === "json" ? "/assets/sprites.svg" : "/api/rooms";
	const lobby = new Lobby({
		endpoint: lobbyEndpoint,
		pollIntervalMs: 3500,
		timeoutMs: 3000,
	});
	const view = mountLobbyView(lobby);

	lobby.addEventListener("join", (e) => {
		startMultiplayerBattle(e.detail.room);
	});

	view.show();
	lobby.start();
}

async function runAssetPipeline() {
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
		const manifest = await fetchJson(manifestUrl, { signal });

		if (failMode === "404") {
			manifest.sprites.sheet = "/assets/nonexistent-tank-sheet-404.png";
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

		await new Promise((r) => setTimeout(r, 250));
		openLobby();
	} catch (err) {
		console.error("[AssetPipeline Failure]", err);
		loadingState.error = `${err.name}: ${err.message}`;
	}
}

window.addEventListener("keydown", (e) => {
	if (e.code === "KeyM" && screenMode === "playing" && !chatView.isTyping()) {
		audio.toggleMute();
	}
	if (screenMode === "loading" && loadingState.error) {
		if (e.code === "KeyR") {
			window.history.replaceState({}, "", window.location.pathname);
			runAssetPipeline();
		} else if (e.code === "Enter") {
			openLobby();
		}
	}
});

canvas.addEventListener("click", () => {
	if (screenMode === "loading" && loadingState.error) {
		window.history.replaceState({}, "", window.location.pathname);
		runAssetPipeline();
	}
});

const loop = createLoop({
	step: 1 / 30,
	simulate(dt) {
		if (screenMode === "playing") {
			const controls = readControls();
			const inputPacket = session.stepLocalPrediction(dt, controls);
			connection.sendInput(inputPacket);
		}
		rawInput.endStep();
	},
	render() {
		if (screenMode === "loading") {
			drawLoadingScreen(ctx, arena, loadingState);
		} else if (screenMode === "playing") {
			const entities = session.getRenderEntities();
			drawMultiplayerWorld(ctx, arena, session.arena, entities, loadedAssets);
			hud.draw(ctx, loop.getStats(), currentRoomName, session.localShip, audio);
		}
	},
});

loop.start();
runAssetPipeline();
