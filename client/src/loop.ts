export interface LoopStats {
	readonly stepsPerSec: number;
	readonly framesPerSec: number;
}

export interface GameLoop {
	start(): void;
	stop(): void;
	getStats(): LoopStats;
}

export function createLoop(params: {
	step: number;
	simulate: (dt: number) => void;
	render: (alpha: number) => void;
}): GameLoop {
	const { step, simulate, render } = params;
	let running = false;
	let lastTime = 0;
	let accumulator = 0;
	let stepsAcc = 0;
	let framesAcc = 0;
	let statsTimer = 0;
	let stepsPerSec = 0;
	let framesPerSec = 0;

	function frame(now: number): void {
		if (!running) return;
		const frameDt = Math.min(0.25, (now - lastTime) / 1000);
		lastTime = now;
		accumulator += frameDt;
		statsTimer += frameDt;

		while (accumulator >= step) {
			simulate(step);
			accumulator -= step;
			stepsAcc += 1;
		}

		render(accumulator / step);
		framesAcc += 1;

		if (statsTimer >= 1) {
			stepsPerSec = stepsAcc;
			framesPerSec = framesAcc;
			stepsAcc = 0;
			framesAcc = 0;
			statsTimer = 0;
		}

		requestAnimationFrame(frame);
	}

	return {
		start() {
			if (running) return;
			running = true;
			lastTime = performance.now();
			requestAnimationFrame(frame);
		},
		stop() {
			running = false;
		},
		getStats: () => ({ stepsPerSec, framesPerSec }),
	};
}
