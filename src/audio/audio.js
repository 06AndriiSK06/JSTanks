export function createAudioEngine() {
	const AudioCtx = window.AudioContext || window.webkitAudioContext;
	const ctx = new AudioCtx();
	let buffers = {};
	let muted = false;

	const unlock = () => {
		if (ctx.state === "suspended") {
			ctx.resume().catch(() => {});
		}
	};

	window.addEventListener("pointerdown", unlock, { passive: true });
	window.addEventListener("keydown", unlock, { passive: true });

	function play(name, { volume = 0.7, rate = 1 } = {}) {
		if (muted || !buffers[name]) return;
		if (ctx.state === "suspended") {
			ctx.resume().catch(() => {});
		}

		const source = ctx.createBufferSource();
		source.buffer = buffers[name];
		source.playbackRate.value = rate * (0.94 + Math.random() * 0.12);

		const gain = ctx.createGain();
		gain.gain.value = volume;

		source.connect(gain);
		gain.connect(ctx.destination);
		source.start(0);
	}

	function bindWorld(world) {
		world.addEventListener("fired", (e) => {
			const isMissile = Boolean(e.detail?.isMissile);
			play("shoot", {
				volume: isMissile ? 0.85 : 0.55,
				rate: isMissile ? 0.72 : 1.05,
			});
		});

		world.addEventListener("hit", () => {
			play("hit", { volume: 0.5 });
		});

		world.addEventListener("exploded", (e) => {
			const isShip = e.detail?.kind === "ship";
			play("explosion", {
				volume: isShip ? 0.95 : 0.7,
				rate: isShip ? 0.8 : 1.0,
			});
		});

		world.addEventListener("pickup", () => {
			play("pickup", { volume: 0.65 });
		});
	}

	return {
		ctx,
		setBuffers(decodedMap) {
			buffers = decodedMap ?? {};
		},
		bindWorld,
		play,
		toggleMute() {
			muted = !muted;
			return muted;
		},
		isMuted() {
			return muted;
		},
	};
}
