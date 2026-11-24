import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export class NdjsonTransform extends Transform {
	constructor() {
		super({ writableObjectMode: true, readableObjectMode: false });
	}

	_transform(chunk, _encoding, callback) {
		try {
			const line = `${JSON.stringify(chunk)}\n`;
			callback(null, Buffer.from(line, "utf8"));
		} catch (err) {
			callback(err);
		}
	}
}

export async function createMatchLogger({ logDir, roomId }) {
	await mkdir(logDir, { recursive: true });
	const safeRoom = roomId.replace(/[^a-zA-Z0-9_-]/g, "_");
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const fileName = `${safeRoom}-${stamp}.ndjson`;
	const filePath = path.join(logDir, fileName);

	const source = new PassThrough({ objectMode: true });
	const transform = new NdjsonTransform();
	const sink = createWriteStream(filePath, { flags: "a" });

	source.on("error", (err) => console.error("[MatchLog source error]", err));
	transform.on("error", (err) =>
		console.error("[MatchLog transform error]", err),
	);
	sink.on("error", (err) => console.error("[MatchLog sink error]", err));

	const done = pipeline(source, transform, sink).catch((err) => {
		console.error(`[MatchLog pipeline failed for ${fileName}]`, err);
	});

	return {
		fileName,
		filePath,
		logEvent(event) {
			if (!source.writableEnded) {
				source.write({ t: Date.now(), roomId, ...event });
			}
		},
		async close() {
			if (!source.writableEnded) {
				source.end();
			}
			await done;
		},
	};
}
