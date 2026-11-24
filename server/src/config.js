import path from "node:path";

function parsePositiveInt(raw, fallback, name) {
	if (raw === undefined || raw === "") return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(
			`Invalid environment variable ${name}: "${raw}" (must be a positive integer)`,
		);
	}
	return parsed;
}

export function loadConfig(env = process.env) {
	const port = parsePositiveInt(env.PORT, 3000, "PORT");
	const host = (env.HOST ?? "0.0.0.0").trim();
	if (!host) {
		throw new Error("Invalid environment variable HOST: cannot be empty");
	}

	const rawLogDir = (env.LOG_DIR ?? "./logs").trim();
	if (!rawLogDir) {
		throw new Error("Invalid environment variable LOG_DIR: cannot be empty");
	}

	const logDir = path.resolve(import.meta.dirname, "..", rawLogDir);
	const clientDistDir = path.resolve(import.meta.dirname, "../../client/dist");
	const maxRooms = parsePositiveInt(env.MAX_ROOMS, 20, "MAX_ROOMS");
	const maxPlayersPerRoom = parsePositiveInt(
		env.MAX_PLAYERS_PER_ROOM,
		8,
		"MAX_PLAYERS_PER_ROOM",
	);

	return Object.freeze({
		port,
		host,
		logDir,
		clientDistDir,
		maxRooms,
		maxPlayersPerRoom,
		maxPayloadBytes: 4096,
		joinTimeoutMs: 5000,
		heartbeatIntervalMs: 15000,
		rateLimitPerSec: 12,
		bufferedAmountLimitBytes: 64 * 1024,
	});
}
