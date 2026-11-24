import { fetchJson, loadAll } from "./assets/loader.js";
import { createAudioEngine } from "./audio/audio.js";
import { createInput } from "./input.js";
import { Lobby } from "./lobby/lobby.js";
import { mountLobbyView } from "./lobby/lobbyView.js";
import { createLoop } from "./loop.js";
import { setupCanvas } from "./render/canvas.js";
import {
	createHudRenderer,
	drawLoadingScreen,
	drawWorld,
} from "./render/draw.js";
import { createArena } from "./sim/arena.js";
import { Ship } from "./sim/ship.js";
import { World } from "./sim/world.js";

const canvas = document.getElementById("game");
const arena = createArena(window.innerWidth, window.innerHeight);

const { ctx } = setupCanvas(canvas, (width, height) => {
	arena.width = width;
	arena.height = height;
});

const params = new URLSearchParams(window.location.search);
const failMode = params.get("fail"); // "404" | "timeout" | "abort" | "json"
const sequentialMode = params.get("mode") === "seq";

const audio = createAudioEngine();
const hud = createHudRenderer();

const loadingState = {
	done: 0,
	total: 6,
	ratio: 0,
	label: "Loading manifest...",
	error: null,
	elapsedMs: null,
	mode: sequentialMode ? "sequential" : "concurrent",
};

let screenMode = "loading"; // "loading" | "lobby" | "playing"
let loadedAssets = null;
let world = null;
let ship = null;
const input = createInput(window);

function startBattle(roomConfig) {
	arena.gridSize = loadedAssets?.arenaConfig?.gridSize ?? 48;
	world = new World({ arena, input, roomConfig });
	ship = world.spawn(new Ship(arena.width / 2, arena.height / 2));
	world.spawnWave(roomConfig.initialAsteroids ?? 5);

	audio.bindWorld(world);
	hud.bindWorld(world);

	screenMode = "playing";
}

function openLobby() {
	screenMode = "lobby";
	const lobbyEndpoint =
		failMode === "json" ? "/assets/sprites.svg" : "/api/rooms.json";
	const lobby = new Lobby({
		endpoint: lobbyEndpoint,
		pollIntervalMs: 4000,
		timeoutMs: 3000,
	});
	const view = mountLobbyView(lobby);

	lobby.addEventListener("join", (e) => {
		startBattle(e.detail.room);
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
		loadingState.label = `Ready! Loaded in ${loadedAssets.elapsedMs.toFixed(1)} ms`;
		console.info(
			`[AssetPipeline] Mode: ${loadedAssets.mode} | Total time: ${loadedAssets.elapsedMs.toFixed(2)} ms`,
		);
		audio.setBuffers(loadedAssets.sounds);

		await new Promise((r) => setTimeout(r, 350));
		openLobby();
	} catch (err) {
		console.error("[AssetPipeline Failure]", err);
		loadingState.error = `${err.name}: ${err.message}`;
	}
}

window.addEventListener("keydown", (e) => {
	if (e.code === "KeyM" && screenMode === "playing") {
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
	step: 1 / 60,
	simulate(dt) {
		if (screenMode === "playing" && world) {
			world.step(dt);
		}
		input.endStep();
	},
	render(alpha) {
		if (screenMode === "loading") {
			drawLoadingScreen(ctx, arena, loadingState);
		} else if (screenMode === "playing" && world && ship) {
			drawWorld(ctx, world, alpha, loadedAssets);
			hud.draw(ctx, loop.getStats(), world, ship, audio);
		}
	},
});

loop.start();
runAssetPipeline();
