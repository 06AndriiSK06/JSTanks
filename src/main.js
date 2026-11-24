import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { setupCanvas } from "./render/canvas.js";
import {
	drawArena,
	drawHud,
	drawShip,
	interpolateState,
} from "./render/draw.js";
import { createArena, wrapArena } from "./sim/arena.js";
import { cloneShip, createShip, integrate } from "./sim/ship.js";

const canvas = document.getElementById("game");
const arena = createArena(window.innerWidth, window.innerHeight);

const { ctx } = setupCanvas(canvas, (width, height) => {
	arena.width = width;
	arena.height = height;
});

const input = createInput(window);
const currentShip = createShip(arena.width / 2, arena.height / 2);
let previousShip = cloneShip(currentShip);

const loop = createLoop({
	step: 1 / 60,
	simulate(dt) {
		previousShip = cloneShip(currentShip);
		integrate(currentShip, input, dt);
		wrapArena(currentShip, arena);
		input.endStep();
	},
	render(alpha) {
		const interpolatedShip = interpolateState(
			previousShip,
			currentShip,
			alpha,
			arena,
		);
		drawArena(ctx, arena);
		drawShip(ctx, interpolatedShip);
		drawHud(ctx, loop.getStats(), currentShip);
	},
});

loop.start();
