import { z } from "zod";

const SpriteFrameSchema = z.object({
	sx: z.number(),
	sy: z.number(),
	sw: z.number(),
	sh: z.number(),
});

export const AssetManifestSchema = z.object({
	sprites: z.object({
		sheet: z.string(),
		frames: z.record(z.string(), SpriteFrameSchema),
	}),
	sounds: z.record(z.string(), z.string()),
	config: z.object({
		arena: z.string(),
	}),
});

export type AssetManifest = z.infer<typeof AssetManifestSchema>;

export interface LoadedAssets {
	readonly spriteSheet: HTMLImageElement;
	readonly spriteMeta: AssetManifest["sprites"];
	readonly sounds: Readonly<Record<string, AudioBuffer>>;
	readonly arenaConfig: { readonly gridSize?: number };
	readonly elapsedMs: number;
	readonly mode: "sequential" | "concurrent";
}

class HttpStatusError extends Error {
	readonly status: number;
	constructor(url: string, status: number) {
		super(`HTTP ${status} for ${url}`);
		this.name = "HttpStatusError";
		this.status = status;
	}
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	options: {
		retries?: number;
		baseDelayMs?: number;
		signal?: AbortSignal;
	} = {},
): Promise<T> {
	const retries = options.retries ?? 2;
	const baseDelayMs = options.baseDelayMs ?? 120;
	let attempt = 0;

	while (true) {
		options.signal?.throwIfAborted();
		try {
			return await fn();
		} catch (err: unknown) {
			if (options.signal?.aborted) throw err;
			if (
				err instanceof DOMException &&
				(err.name === "AbortError" || err.name === "TimeoutError")
			) {
				throw err;
			}
			if (
				err instanceof HttpStatusError &&
				err.status >= 400 &&
				err.status < 500
			) {
				throw err;
			}
			if (attempt >= retries) {
				throw err;
			}
			const jitter = Math.random() * 60;
			const delay = baseDelayMs * 2 ** attempt + jitter;
			attempt += 1;
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(resolve, delay);
				options.signal?.addEventListener(
					"abort",
					() => {
						clearTimeout(timer);
						reject(
							options.signal?.reason ??
								new DOMException("Aborted", "AbortError"),
						);
					},
					{ once: true },
				);
			});
		}
	}
}

export async function fetchJson<T>(
	url: string,
	options: { signal?: AbortSignal } = {},
): Promise<T> {
	return withRetry(async () => {
		const res = await fetch(url, { signal: options.signal ?? null });
		if (!res.ok) {
			throw new HttpStatusError(url, res.status);
		}
		return (await res.json()) as T;
	}, options);
}

export function loadImage(
	url: string,
	options: { signal?: AbortSignal } = {},
): Promise<HTMLImageElement> {
	return withRetry(
		() =>
			new Promise<HTMLImageElement>((resolve, reject) => {
				if (options.signal?.aborted) {
					reject(
						options.signal.reason ?? new DOMException("Aborted", "AbortError"),
					);
					return;
				}
				const img = new Image();
				const onAbort = (): void => {
					img.src = "";
					reject(
						options.signal?.reason ?? new DOMException("Aborted", "AbortError"),
					);
				};
				options.signal?.addEventListener("abort", onAbort, { once: true });

				img.onload = () => {
					options.signal?.removeEventListener("abort", onAbort);
					resolve(img);
				};
				img.onerror = () => {
					options.signal?.removeEventListener("abort", onAbort);
					reject(new HttpStatusError(url, 404));
				};
				img.src = url;
			}),
		options,
	);
}

export async function loadAudio(
	url: string,
	audioCtx: AudioContext,
	options: { signal?: AbortSignal } = {},
): Promise<AudioBuffer> {
	return withRetry(async () => {
		const res = await fetch(url, { signal: options.signal ?? null });
		if (!res.ok) {
			throw new HttpStatusError(url, res.status);
		}
		const arrayBuffer = await res.arrayBuffer();
		return audioCtx.decodeAudioData(arrayBuffer);
	}, options);
}

export async function loadAll(
	rawManifest: unknown,
	options: {
		audioCtx: AudioContext;
		signal?: AbortSignal;
		sequential?: boolean;
		onProgress?: (p: {
			done: number;
			total: number;
			ratio: number;
			label: string;
		}) => void;
	},
): Promise<LoadedAssets> {
	const manifest = AssetManifestSchema.parse(rawManifest);
	const soundEntries = Object.entries(manifest.sounds);
	const total = 2 + soundEntries.length;
	let done = 0;

	const report = (label: string): void => {
		done += 1;
		options.onProgress?.({ done, total, ratio: done / total, label });
	};

	const t0 = performance.now();
	const sounds: Record<string, AudioBuffer> = {};
	let spriteSheet!: HTMLImageElement;
	let arenaConfig: { gridSize?: number } = {};

	if (options.sequential) {
		spriteSheet = await loadImage(manifest.sprites.sheet, {
			signal: options.signal,
		});
		report(`Loaded ${manifest.sprites.sheet}`);
		arenaConfig = await fetchJson<{ gridSize?: number }>(
			manifest.config.arena,
			{
				signal: options.signal,
			},
		);
		report(`Loaded ${manifest.config.arena}`);
		for (const [key, url] of soundEntries) {
			sounds[key] = await loadAudio(url, options.audioCtx, {
				signal: options.signal,
			});
			report(`Decoded ${key}`);
		}
	} else {
		const tasks: Array<Promise<void>> = [
			loadImage(manifest.sprites.sheet, { signal: options.signal }).then(
				(img) => {
					spriteSheet = img;
					report(`Loaded ${manifest.sprites.sheet}`);
				},
			),
			fetchJson<{ gridSize?: number }>(manifest.config.arena, {
				signal: options.signal,
			}).then((cfg) => {
				arenaConfig = cfg;
				report(`Loaded ${manifest.config.arena}`);
			}),
			...soundEntries.map(([key, url]) =>
				loadAudio(url, options.audioCtx, { signal: options.signal }).then(
					(buf) => {
						sounds[key] = buf;
						report(`Decoded ${key}`);
					},
				),
			),
		];
		await Promise.all(tasks);
	}

	return {
		spriteSheet,
		spriteMeta: manifest.sprites,
		sounds,
		arenaConfig,
		elapsedMs: performance.now() - t0,
		mode: options.sequential ? "sequential" : "concurrent",
	};
}
