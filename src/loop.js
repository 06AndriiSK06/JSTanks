export function createLoop({ step = 1 / 60, simulate, render }) {
	let rafId = null;
	let running = false;
	let lastTime = 0;
	let accumulator = 0;

	let statsTimer = 0;
	let stepCounter = 0;
	let frameCounter = 0;

	const stats = {
		stepsPerSec: 60,
		framesPerSec: 60,
		frameTimeMs: 0,
	};

	function frame(now) {
		if (!running) return;

		const frameStart = performance.now();
		const rawDt = (now - lastTime) / 1000;
		lastTime = now;

		const clampedDt = Math.min(Math.max(rawDt, 0), 0.25);
		accumulator += clampedDt;

		while (accumulator >= step) {
			simulate(step);
			accumulator -= step;
			stepCounter += 1;
		}

		const alpha = accumulator / step;
		render(alpha);
		frameCounter += 1;

		stats.frameTimeMs = performance.now() - frameStart;
		statsTimer += clampedDt;

		if (statsTimer >= 1) {
			stats.stepsPerSec = Math.round(stepCounter / statsTimer);
			stats.framesPerSec = Math.round(frameCounter / statsTimer);
			stepCounter = 0;
			frameCounter = 0;
			statsTimer = 0;
		}

		rafId = requestAnimationFrame(frame);
	}

	return {
		start() {
			if (running) return;
			running = true;
			lastTime = performance.now();
			accumulator = 0;
			statsTimer = 0;
			stepCounter = 0;
			frameCounter = 0;
			rafId = requestAnimationFrame(frame);
		},
		stop() {
			running = false;
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
		},
		getStats() {
			return { ...stats };
		},
	};
}
