export function setupCanvas(
	canvas: HTMLCanvasElement,
	onResize?: (width: number, height: number) => void,
): { ctx: CanvasRenderingContext2D } {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("2D canvas context is unavailable");
	}

	const resize = (): void => {
		const dpr = window.devicePixelRatio || 1;
		const width = window.innerWidth;
		const height = window.innerHeight;
		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(height * dpr);
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		onResize?.(width, height);
	};

	window.addEventListener("resize", resize);
	resize();
	return { ctx };
}
