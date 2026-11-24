import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface MatchLogEntry {
	readonly t?: number;
	readonly roomId?: string;
	readonly type: string;
	readonly [key: string]: unknown;
}

export class NdjsonTransform extends Transform {
	constructor() {
		super({ writableObjectMode: true, readableObjectMode: false });
	}

	override _transform(
		chunk: unknown,
		_encoding: BufferEncoding,
		callback: TransformCallback,
	): void {
		try {
			const line = `${JSON.stringify(chunk)}\n`;
			callback(null, Buffer.from(line, "utf8"));
		} catch (err: unknown) {
			callback(err instanceof Error ? err : new Error(String(err)));
		}
	}
}

export interface MatchLogger {
	readonly fileName: string;
	readonly filePath: string;
	logEvent(event: MatchLogEntry): void;
	close(): Promise<void>;
}

export async function createMatchLogger(params: {
	logDir: string;
	roomId: string;
}): Promise<MatchLogger> {
	const { logDir, roomId } = params;
	await mkdir(logDir, { recursive: true });

	const safeRoom = roomId.replace(/[^a-zA-Z0-9_-]/g, "_");
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const fileName = `${safeRoom}-${stamp}.ndjson`;
	const filePath = path.join(logDir, fileName);

	const source = new PassThrough({ objectMode: true });
	const transform = new NdjsonTransform();
	const sink = createWriteStream(filePath, { flags: "a" });

	source.on("error", (err: unknown) =>
		console.error("[MatchLog source error]", err),
	);
	transform.on("error", (err: unknown) =>
		console.error("[MatchLog transform error]", err),
	);
	sink.on("error", (err: unknown) =>
		console.error("[MatchLog sink error]", err),
	);

	const done = pipeline(source, transform, sink).catch((err: unknown) => {
		console.error(`[MatchLog pipeline failed for ${fileName}]`, err);
	});

	return {
		fileName,
		filePath,
		logEvent(event: MatchLogEntry): void {
			if (!source.writableEnded) {
				source.write({ t: Date.now(), roomId, ...event });
			}
		},
		async close(): Promise<void> {
			if (!source.writableEnded) {
				source.end();
			}
			await done;
		},
	};
}
