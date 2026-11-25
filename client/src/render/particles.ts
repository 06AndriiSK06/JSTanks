export class ParticleSystem {
	private worker: Worker | null = null;
	private latestPoints = new Float32Array(0);
	useWorker = true;
	lastStepUs = 0;

	private readonly fallbackBuf = new Float32Array(256 * 6);
	private fallbackCursor = 0;

	constructor() {
		if (typeof Worker !== "undefined") {
			try {
				this.worker = new Worker(
					new URL("../workers/particles.worker.ts", import.meta.url),
					{
						type: "module",
					},
				);
				this.worker.onmessage = (
					e: MessageEvent<{ type: string; buffer: ArrayBuffer }>,
				) => {
					if (e.data?.type === "frame") {
						this.latestPoints = new Float32Array(e.data.buffer);
					}
				};
			} catch {
				this.worker = null;
			}
		}
	}

	spawnExplosion(x: number, y: number, count = 18): void {
		if (this.useWorker && this.worker) {
			this.worker.postMessage({ type: "spawn", x, y, count });
			return;
		}
		for (let i = 0; i < count; i += 1) {
			const base = this.fallbackCursor * 6;
			this.fallbackCursor = (this.fallbackCursor + 1) % 256;
			const angle = (i / count) * Math.PI * 2;
			const speed = 70 + (i % 5) * 24;
			this.fallbackBuf[base] = x;
			this.fallbackBuf[base + 1] = y;
			this.fallbackBuf[base + 2] = Math.cos(angle) * speed;
			this.fallbackBuf[base + 3] = Math.sin(angle) * speed;
			this.fallbackBuf[base + 4] = 0.45;
			this.fallbackBuf[base + 5] = 0.45;
		}
	}

	step(dt: number): void {
		const t0 = performance.now();
		if (this.useWorker && this.worker) {
			this.worker.postMessage({ type: "step", dt });
			this.lastStepUs = (performance.now() - t0) * 1000;
			return;
		}

		const pts: number[] = [];
		for (let i = 0; i < 256; i += 1) {
			const base = i * 6;
			const ttl = (this.fallbackBuf[base + 4] ?? 0) - dt;
			if (ttl > 0) {
				this.fallbackBuf[base + 4] = ttl;
				const nx =
					(this.fallbackBuf[base] ?? 0) +
					(this.fallbackBuf[base + 2] ?? 0) * dt;
				const ny =
					(this.fallbackBuf[base + 1] ?? 0) +
					(this.fallbackBuf[base + 3] ?? 0) * dt;
				this.fallbackBuf[base] = nx;
				this.fallbackBuf[base + 1] = ny;
				pts.push(nx, ny, ttl / (this.fallbackBuf[base + 5] ?? 0.45));
			} else {
				this.fallbackBuf[base + 4] = 0;
			}
		}
		this.latestPoints = new Float32Array(pts);
		this.lastStepUs = (performance.now() - t0) * 1000;
	}

	draw(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number): void {
		const data = this.latestPoints;
		if (data.length === 0) return;
		ctx.save();
		ctx.translate(offsetX, offsetY);
		for (let i = 0; i < data.length; i += 3) {
			const x = data[i] ?? 0;
			const y = data[i + 1] ?? 0;
			const alpha = data[i + 2] ?? 0;
			ctx.fillStyle = `rgba(251, 146, 60, ${alpha.toFixed(2)})`;
			ctx.fillRect(x - 2, y - 2, 4, 4);
		}
		ctx.restore();
	}
}
