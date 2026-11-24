import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";

export async function* readReplayEvents(filePath) {
	const stream = createReadStream(filePath, { encoding: "utf8" });
	const rl = createInterface({ input: stream, crlfDelay: Infinity });

	for await (const line of rl) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		yield JSON.parse(trimmed);
	}
}

export async function listReplays(logDir) {
	try {
		const entries = await readdir(logDir);
		const items = [];
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

export async function streamReplayToResponse(logDir, replayId, res) {
	if (
		!replayId ||
		replayId.includes("..") ||
		replayId.includes("/") ||
		replayId.includes("\\")
	) {
		res.writeHead(400, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Invalid replay id" }));
		return;
	}

	const filePath = path.join(logDir, replayId);
	let info;
	try {
		info = await stat(filePath);
		if (!info.isFile()) throw new Error("Not a file");
	} catch {
		res.writeHead(404, { "Content-Type": "application/json" });
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
