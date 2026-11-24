function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		function onAbort() {
			clearTimeout(timer);
			reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
		}

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export async function withRetry(
	fn,
	{ attempts = 3, baseMs = 200, signal } = {},
) {
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		if (signal?.aborted) {
			throw signal.reason ?? new DOMException("Aborted", "AbortError");
		}
		try {
			return await fn(attempt);
		} catch (err) {
			lastError = err;
			if (err.name === "AbortError" || signal?.aborted) {
				throw err;
			}
			// Ніколи не повторюємо клієнтські помилки 4xx (наприклад, 404 Not Found)
			if (
				typeof err.status === "number" &&
				err.status >= 400 &&
				err.status < 500
			) {
				throw err;
			}
			if (attempt === attempts) {
				throw err;
			}
			const expDelay = baseMs * 2 ** (attempt - 1);
			const jitter = Math.random() * baseMs;
			await sleep(expDelay + jitter, signal);
		}
	}
	throw lastError;
}

export async function fetchJson(url, { signal } = {}) {
	const response = await fetch(url, { signal });
	if (!response.ok) {
		const err = new Error(`HTTP ${response.status} while fetching ${url}`);
		err.status = response.status;
		throw err;
	}
	return response.json();
}

export function loadJson(url, { signal, attempts = 3 } = {}) {
	return withRetry(() => fetchJson(url, { signal }), { attempts, signal });
}

export function loadImage(src, { signal, attempts = 3 } = {}) {
	return withRetry(
		() =>
			new Promise((resolve, reject) => {
				if (signal?.aborted) {
					reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
					return;
				}

				const img = new Image();
				const cleanup = () => {
					img.onload = null;
					img.onerror = null;
					signal?.removeEventListener("abort", onAbort);
				};

				function onAbort() {
					cleanup();
					img.src = "";
					reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
				}

				img.onload = () => {
					cleanup();
					resolve(img);
				};

				img.onerror = () => {
					cleanup();
					const err = new Error(
						`Failed to load image: ${src} (404 or decode error)`,
					);
					err.status = 404;
					reject(err);
				};

				signal?.addEventListener("abort", onAbort, { once: true });
				img.src = src;
			}),
		{ attempts, signal },
	);
}

export function loadAudio(audioCtx, url, { signal, attempts = 3 } = {}) {
	return withRetry(
		async () => {
			const response = await fetch(url, { signal });
			if (!response.ok) {
				const err = new Error(
					`HTTP ${response.status} while fetching audio ${url}`,
				);
				err.status = response.status;
				throw err;
			}
			const arrayBuffer = await response.arrayBuffer();
			if (signal?.aborted) {
				throw signal.reason ?? new DOMException("Aborted", "AbortError");
			}
			return audioCtx.decodeAudioData(arrayBuffer);
		},
		{ attempts, signal },
	);
}

export async function loadAll(
	manifest,
	{ audioCtx, onProgress, signal, sequential = false } = {},
) {
	const startTime = performance.now();
	const tasks = [];

	tasks.push({
		key: "spriteSheet",
		label: `Sprite sheet (${manifest.sprites.sheet})`,
		run: () => loadImage(manifest.sprites.sheet, { signal }),
	});

	tasks.push({
		key: "arenaConfig",
		label: `Arena config (${manifest.arenaConfig})`,
		run: () => loadJson(manifest.arenaConfig, { signal }),
	});

	for (const [soundName, soundUrl] of Object.entries(manifest.sounds)) {
		tasks.push({
			key: `sound:${soundName}`,
			label: `Audio [${soundName}] (${soundUrl})`,
			run: () => loadAudio(audioCtx, soundUrl, { signal }),
		});
	}

	let done = 0;
	const total = tasks.length;
	onProgress?.({ done, total, ratio: 0, label: "Starting asset pipeline..." });

	const track = async (task) => {
		const value = await task.run();
		done += 1;
		onProgress?.({
			done,
			total,
			ratio: done / total,
			label: `Loaded: ${task.label}`,
		});
		return [task.key, value];
	};

	let entries;
	if (sequential) {
		entries = [];
		for (const task of tasks) {
			entries.push(await track(task));
		}
	} else {
		entries = await Promise.all(tasks.map((task) => track(task)));
	}

	const map = Object.fromEntries(entries);
	const sounds = {};
	for (const [k, v] of entries) {
		if (k.startsWith("sound:")) {
			sounds[k.replace("sound:", "")] = v;
		}
	}

	const elapsedMs = performance.now() - startTime;
	return {
		spriteSheet: map.spriteSheet,
		spriteMeta: manifest.sprites,
		arenaConfig: map.arenaConfig,
		sounds,
		elapsedMs,
		mode: sequential ? "sequential" : "concurrent",
	};
}
