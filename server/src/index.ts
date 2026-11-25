import { createReadStream, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { listReplays, streamReplayToResponse } from "./log/replay.js";
import { RoomManager } from "./rooms.js";
import { attachWebSocketServer } from "./ws.js";

const MIME_TYPES: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".wav": "audio/wav",
	".ico": "image/x-icon",
};

const CreateRoomBodySchema = z.object({
	name: z.string().trim().min(1).max(40),
	difficulty: z.enum(["Normal", "Hard", "Insane"]).default("Normal"),
	initialAsteroids: z.coerce.number().int().min(3).max(15).default(5),
});

const AddBotsBodySchema = z.object({
	count: z.coerce.number().int().min(1).max(32).default(8),
});

class HttpError extends Error {
	readonly statusCode: number;
	constructor(statusCode: number, message: string) {
		super(message);
		this.statusCode = statusCode;
	}
}

function sendJson(
	res: ServerResponse,
	statusCode: number,
	data: unknown,
): void {
	const body = JSON.stringify(data);
	res.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(body),
	});
	res.end(body);
}

function readJsonBody(req: IncomingMessage, maxBytes = 8192): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;

		req.on("data", (chunk: Buffer) => {
			total += chunk.length;
			if (total > maxBytes) {
				const err = new HttpError(413, "Request body too large");
				req.destroy(err);
				reject(err);
				return;
			}
			chunks.push(chunk);
		});

		req.on("end", () => {
			try {
				const raw = Buffer.concat(chunks).toString("utf8");
				resolve(raw ? (JSON.parse(raw) as unknown) : {});
			} catch {
				reject(new HttpError(400, "Malformed JSON body"));
			}
		});

		req.on("error", reject);
	});
}

async function serveStatic(
	distDir: string,
	pathname: string,
	res: ServerResponse,
): Promise<void> {
	if (pathname.includes("..")) {
		sendJson(res, 403, { error: "Path traversal forbidden" });
		return;
	}

	const relativePath =
		pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
	const resolvedPath = path.resolve(distDir, relativePath);

	if (!resolvedPath.startsWith(distDir)) {
		sendJson(res, 403, { error: "Path traversal forbidden" });
		return;
	}

	let fileStat: Stats;
	try {
		fileStat = await stat(resolvedPath);
		if (!fileStat.isFile()) throw new Error("Not a file");
	} catch {
		if (path.extname(resolvedPath)) {
			sendJson(res, 404, { error: "Asset not found" });
			return;
		}
		try {
			const indexHtml = path.join(distDir, "index.html");
			const indexStat = await stat(indexHtml);
			res.writeHead(200, {
				"Content-Type": "text/html; charset=utf-8",
				"Content-Length": indexStat.size,
			});
			await pipeline(createReadStream(indexHtml), res);
		} catch {
			sendJson(res, 503, {
				error:
					"Client build not found. Run `npm run build` or use Vite dev server.",
			});
		}
		return;
	}

	const ext = path.extname(resolvedPath).toLowerCase();
	const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
	res.writeHead(200, {
		"Content-Type": contentType,
		"Content-Length": fileStat.size,
	});
	await pipeline(createReadStream(resolvedPath), res);
}

const config = loadConfig();
const roomManager = new RoomManager({
	logDir: config.logDir,
	maxRooms: config.maxRooms,
	maxPlayersPerRoom: config.maxPlayersPerRoom,
});

let lastElu = performance.eventLoopUtilization();

const server = http.createServer(
	async (req: IncomingMessage, res: ServerResponse) => {
		try {
			const url = new URL(
				req.url ?? "/",
				`http://${req.headers.host ?? "localhost"}`,
			);
			const pathname = decodeURIComponent(url.pathname);

			if (req.method === "GET" && pathname === "/health") {
				sendJson(res, 200, {
					status: "ok",
					uptimeSec: Math.round(process.uptime()),
					rooms: roomManager.listRooms().length,
					rssBytes: process.memoryUsage().rss,
				});
				return;
			}

			if (req.method === "GET" && pathname === "/api/stats") {
				const currentElu = performance.eventLoopUtilization(lastElu);
				lastElu = performance.eventLoopUtilization();
				sendJson(res, 200, {
					uptimeSec: Math.round(process.uptime()),
					rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1)),
					eventLoopUtilization: Number(currentElu.utilization.toFixed(4)),
					rooms: roomManager.getStats(),
				});
				return;
			}

			if (req.method === "GET" && pathname === "/api/rooms") {
				sendJson(res, 200, roomManager.listRooms());
				return;
			}

			if (req.method === "POST" && pathname === "/api/rooms") {
				const rawBody = await readJsonBody(req, 4096);
				const parsed = CreateRoomBodySchema.safeParse(rawBody);
				if (!parsed.success) {
					sendJson(res, 400, {
						error: parsed.error.issues[0]?.message ?? "Invalid room payload",
					});
					return;
				}
				const room = roomManager.createRoom(parsed.data);
				sendJson(res, 201, room.toSummary());
				return;
			}

			const botMatch = /^\/api\/rooms\/([^/]+)\/bots$/.exec(pathname);
			if (req.method === "POST" && botMatch && botMatch[1]) {
				const room = roomManager.getRoom(botMatch[1]);
				if (!room) {
					sendJson(res, 404, { error: "Room not found" });
					return;
				}
				const rawBody = await readJsonBody(req, 2048);
				const parsed = AddBotsBodySchema.safeParse(rawBody);
				if (!parsed.success) {
					sendJson(res, 400, { error: "Invalid bot count" });
					return;
				}
				const added = room.addBots(parsed.data.count);
				sendJson(res, 201, {
					added,
					totalPlayers: room.playerCount,
					roster: room.getRoster(),
				});
				return;
			}

			if (req.method === "GET" && pathname === "/api/replays") {
				const replays = await listReplays(config.logDir);
				sendJson(res, 200, replays);
				return;
			}

			if (req.method === "GET" && pathname.startsWith("/api/replays/")) {
				const replayId = pathname.slice("/api/replays/".length);
				await streamReplayToResponse(config.logDir, replayId, res);
				return;
			}

			if (req.method === "GET" && pathname === "/api/slow") {
				const start = performance.now();
				while (performance.now() - start < 300) {
					// Діагностичне блокування Event Loop на 300 мс
				}
				sendJson(res, 200, {
					blockedMs: Math.round(performance.now() - start),
				});
				return;
			}

			if (req.method === "GET") {
				await serveStatic(config.clientDistDir, pathname, res);
				return;
			}

			sendJson(res, 405, { error: "Method Not Allowed" });
		} catch (err: unknown) {
			const status = err instanceof HttpError ? err.statusCode : 500;
			const message =
				err instanceof Error ? err.message : "Internal Server Error";
			if (!res.headersSent) {
				sendJson(res, status, { error: message });
			}
		}
	},
);

const wsControl = attachWebSocketServer({ server, roomManager, config });

server.listen(config.port, config.host, () => {
	console.log(
		`[JSTanks Server TS] Authoritative 30Hz server on http://${config.host}:${config.port}`,
	);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(
		`\n[JSTanks Server TS] Received ${signal}. Starting graceful shutdown...`,
	);

	await wsControl.close();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await roomManager.closeAll();

	console.log(
		"[JSTanks Server TS] All sockets closed and match logs flushed. Exiting 0.",
	);
	process.exit(0);
}

process.on("SIGINT", () => {
	void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
	void shutdown("SIGTERM");
});
