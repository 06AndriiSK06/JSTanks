export function setupCanvas(canvas, onResize) {
	const ctx = canvas.getContext("2d");

	function resize() {
		const dpr = window.devicePixelRatio || 1;
		const width = window.innerWidth;
		const height = window.innerHeight;

		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		if (onResize) {
			onResize(width, height);
		}
	}

	resize();
	window.addEventListener("resize", resize);

	return {
		ctx,
		destroy() {
			window.removeEventListener("resize", resize);
		},
	};
}
