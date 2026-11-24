import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { setupCanvas } from "./render/canvas.js";
import { drawHud, drawWorld } from "./render/draw.js";
import { createArena } from "./sim/arena.js";
import { Ship } from "./sim/ship.js";
import { World } from "./sim/world.js";

const canvas = document.getElementById("game");
const arena = createArena(window.innerWidth, window.innerHeight);

const { ctx } = setupCanvas(canvas, (width, height) => {
	arena.width = width;
	arena.height = height;
});

const input = createInput(window);
const world = new World({ arena, input });
const ship = world.spawn(new Ship(arena.width / 2, arena.height / 2));
world.spawnWave(5);

const loop = createLoop({
	step: 1 / 60,
	simulate(dt) {
		world.step(dt);
		input.endStep();
	},
	render(alpha) {
		drawWorld(ctx, world, alpha);
		drawHud(ctx, loop.getStats(), world, ship);
	},
});

loop.start();
