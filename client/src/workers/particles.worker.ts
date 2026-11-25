/// <reference lib="webworker" />

const MAX_PARTICLES = 256;
const STRIDE = 6;
const state = new Float32Array(MAX_PARTICLES * STRIDE);
let cursor = 0;

self.onmessage = (e: MessageEvent<unknown>): void => {
	const msg = e.data as
		| { type: "spawn"; x: number; y: number; count: number }
		| { type: "step"; dt: number };

	if (msg.type === "spawn") {
		for (let i = 0; i < msg.count; i += 1) {
			const base = cursor * STRIDE;
			cursor = (cursor + 1) % MAX_PARTICLES;
			const angle = (i / msg.count) * Math.PI * 2 + (i % 3) * 0.21;
			const speed = 60 + (i % 7) * 28;
			state[base] = msg.x;
			state[base + 1] = msg.y;
			state[base + 2] = Math.cos(angle) * speed;
			state[base + 3] = Math.sin(angle) * speed;
			state[base + 4] = 0.45;
			state[base + 5] = 0.45;
		}
		return;
	}

	if (msg.type === "step") {
		const dt = msg.dt;
		let aliveCount = 0;
		for (let i = 0; i < MAX_PARTICLES; i += 1) {
			const base = i * STRIDE;
			const ttl = (state[base + 4] ?? 0) - dt;
			if (ttl > 0) {
				state[base + 4] = ttl;
				state[base] = (state[base] ?? 0) + (state[base + 2] ?? 0) * dt;
				state[base + 1] = (state[base + 1] ?? 0) + (state[base + 3] ?? 0) * dt;
				aliveCount += 1;
			} else {
				state[base + 4] = 0;
			}
		}

		const out = new Float32Array(aliveCount * 3);
		let outIdx = 0;
		for (let i = 0; i < MAX_PARTICLES; i += 1) {
			const base = i * STRIDE;
			const ttl = state[base + 4] ?? 0;
			if (ttl > 0) {
				const maxTtl = state[base + 5] ?? 0.45;
				out[outIdx] = state[base] ?? 0;
				out[outIdx + 1] = state[base + 1] ?? 0;
				out[outIdx + 2] = ttl / maxTtl;
				outIdx += 3;
			}
		}
		self.postMessage({ type: "frame", buffer: out.buffer }, [out.buffer]);
	}
};
