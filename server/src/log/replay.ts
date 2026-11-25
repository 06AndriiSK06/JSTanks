import { createReadStream, type Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";

export interface ReplayFileMeta {
	readonly id: string;
	readonly sizeBytes: number;
	readonly updatedAt: string;
}

export async function* readReplayEvents(
	filePath: string,
): AsyncGenerator<unknown> {
	const stream = createReadStream(filePath, { encoding: "utf8" });
	const rl = createInterface({ input: stream, crlfDelay: Infinity });

	for await (const line of rl) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		yield JSON.parse(trimmed) as unknown;
	}
}

export async function listReplays(logDir: string): Promise<ReplayFileMeta[]> {
	try {
		const entries = await readdir(logDir);
		const items: ReplayFileMeta[] = [];
		for (const name of entries) {
			if (!name.endsWith(".ndjson")) continue;
			const fullPath = path.join(logDir, name);
			const info = await stat(fullPath);
			items.push({
				id: name,
				sizeBytes: info.size,
				updatedAt: info.mtime.toISOString(),
			});
		}
		return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

export async function streamReplayToResponse(
	logDir: string,
	replayId: string,
	res: ServerResponse,
): Promise<void> {
	if (
		!replayId ||
		replayId.includes("..") ||
		replayId.includes("/") ||
		replayId.includes("\\")
	) {
		res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ error: "Invalid replay id" }));
		return;
	}

	const filePath = path.join(logDir, replayId);
	let info: Stats;
	try {
		info = await stat(filePath);
		if (!info.isFile()) throw new Error("Not a file");
	} catch {
		res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ error: "Replay not found" }));
		return;
	}

	res.writeHead(200, {
		"Content-Type": "application/x-ndjson; charset=utf-8",
		"Content-Length": info.size,
	});

	const readStream = createReadStream(filePath);
	await pipeline(readStream, res);
}
