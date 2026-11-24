export interface AudioEngine {
	readonly ctx: AudioContext;
	setBuffers(decodedMap: Readonly<Record<string, AudioBuffer>>): void;
	play(name: string, options?: { volume?: number; rate?: number }): void;
	toggleMute(): boolean;
	isMuted(): boolean;
}

export function createAudioEngine(): AudioEngine {
	const ctx = new AudioContext();
	let buffers: Readonly<Record<string, AudioBuffer>> = {};
	let muted = false;

	const unlock = (): void => {
		if (ctx.state === "suspended") {
			void ctx.resume().catch(() => {});
		}
	};

	window.addEventListener("pointerdown", unlock, { passive: true });
	window.addEventListener("keydown", unlock, { passive: true });

	function play(
		name: string,
		options: { volume?: number; rate?: number } = {},
	): void {
		const buffer = buffers[name];
		if (muted || !buffer) return;
		if (ctx.state === "suspended") {
			void ctx.resume().catch(() => {});
		}

		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.playbackRate.value =
			(options.rate ?? 1) * (0.94 + Math.random() * 0.12);

		const gain = ctx.createGain();
		gain.gain.value = options.volume ?? 0.7;

		source.connect(gain);
		gain.connect(ctx.destination);
		source.start(0);
	}

	return {
		ctx,
		setBuffers(decodedMap) {
			buffers = decodedMap;
		},
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
