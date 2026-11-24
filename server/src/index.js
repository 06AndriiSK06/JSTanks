import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { loadConfig } from "./config.js";
import { listReplays, streamReplayToResponse } from "./log/replay.js";
import { RoomManager } from "./rooms.js";
import { attachWebSocketServer } from "./ws.js";

const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".wav": "audio/wav",
	".ico": "image/x-icon",
};

function sendJson(res, statusCode, data) {
	const body = JSON.stringify(data);
	res.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(body),
	});
	res.end(body);
}

function readJsonBody(req, maxBytes = 8192) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let total = 0;

		req.on("data", (chunk) => {
			total += chunk.length;
			if (total > maxBytes) {
				const err = new Error("Request body too large");
				err.statusCode = 413;
				req.destroy(err);
				reject(err);
				return;
			}
			chunks.push(chunk);
		});

		req.on("end", () => {
			try {
				const raw = Buffer.concat(chunks).toString("utf8");
				resolve(raw ? JSON.parse(raw) : {});
			} catch {
				const err = new Error("Malformed JSON body");
				err.statusCode = 400;
				reject(err);
			}
		});

		req.on("error", reject);
	});
}

async function serveStatic(distDir, pathname, res) {
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

	let fileStat;
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

const server = http.createServer(async (req, res) => {
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
			sendJson(res, 200, {
				uptimeSec: Math.round(process.uptime()),
				rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1)),
				rooms: roomManager.getStats(),
			});
			return;
		}

		if (req.method === "GET" && pathname === "/api/rooms") {
			sendJson(res, 200, roomManager.listRooms());
			return;
		}

		if (req.method === "POST" && pathname === "/api/rooms") {
			const body = await readJsonBody(req, 4096);
			const name = typeof body.name === "string" ? body.name.trim() : "";
			if (!name || name.length > 40) {
				sendJson(res, 400, { error: "Room name is required (1..40 chars)" });
				return;
			}
			const difficulty = ["Normal", "Hard", "Insane"].includes(body.difficulty)
				? body.difficulty
				: "Normal";
			const initialAsteroids = Math.max(
				3,
				Math.min(15, Number(body.initialAsteroids) || 5),
			);
			const room = roomManager.createRoom({
				name,
				difficulty,
				initialAsteroids,
			});
			sendJson(res, 201, room.toSummary());
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
				// Синхронне блокування для тестування Event Loop
			}
			sendJson(res, 200, { blockedMs: Math.round(performance.now() - start) });
			return;
		}

		if (req.method === "GET") {
			await serveStatic(config.clientDistDir, pathname, res);
			return;
		}

		sendJson(res, 405, { error: "Method Not Allowed" });
	} catch (err) {
		const status = err.statusCode ?? 500;
		if (!res.headersSent) {
			sendJson(res, status, { error: err.message ?? "Internal Server Error" });
		}
	}
});

const wsControl = attachWebSocketServer({ server, roomManager, config });

server.listen(config.port, config.host, () => {
	console.log(
		`[JSTanks Server] Authoritative 30Hz server on http://${config.host}:${config.port}`,
	);
});

let shuttingDown = false;
async function shutdown(signal) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(
		`\n[JSTanks Server] Received ${signal}. Starting graceful shutdown...`,
	);

	await wsControl.close();
	await new Promise((resolve) => server.close(() => resolve()));
	await roomManager.closeAll();

	console.log(
		"[JSTanks Server] All sockets closed and match logs flushed. Exiting 0.",
	);
	process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
