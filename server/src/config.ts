import path from "node:path";
import { z } from "zod";

const EnvSchema = z.object({
	PORT: z.coerce.number().int().min(1).max(65535).default(3000),
	HOST: z.string().min(1).default("0.0.0.0"),
	NODE_ENV: z
		.enum(["development", "test", "production"])
		.default("development"),
	LOG_LEVEL: z
		.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
		.default("info"),
	ALLOWED_ORIGINS: z.string().default("*"),
	MAX_CONNECTIONS_PER_IP: z.coerce.number().int().min(1).max(1000).default(10),
	MAX_ROOMS: z.coerce.number().int().min(1).max(500).default(20),
	MAX_PLAYERS_PER_ROOM: z.coerce.number().int().min(2).max(256).default(160),
	STATIC_DIR: z.string().default("client/dist"),
	LOG_DIR: z.string().default("logs"),
	APP_VERSION: z.string().default(process.env.GIT_SHA ?? "dev"),
	MAX_PAYLOAD_BYTES: z.coerce.number().int().min(256).max(65536).default(4096),
	JOIN_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
	HEARTBEAT_INTERVAL_MS: z.coerce
		.number()
		.int()
		.min(1000)
		.max(60000)
		.default(15000),
	BUFFERED_AMOUNT_LIMIT_BYTES: z.coerce.number().int().min(1024).default(65536),
	SIM_LATENCY_MS: z.coerce.number().min(0).max(2000).default(0),
	SIM_JITTER_MS: z.coerce.number().min(0).max(1000).default(0),
	SIM_DROP_RATE: z.coerce.number().min(0).max(0.9).default(0),
});

export interface ServerConfig {
	readonly port: number;
	readonly host: string;
	readonly nodeEnv: "development" | "test" | "production";
	readonly logLevel:
		| "fatal"
		| "error"
		| "warn"
		| "info"
		| "debug"
		| "trace"
		| "silent";
	readonly allowedOrigins: string[] | "*";
	readonly maxConnectionsPerIp: number;
	readonly maxRooms: number;
	readonly maxPlayersPerRoom: number;
	readonly clientDistDir: string;
	readonly logDir: string;
	readonly appVersion: string;
	readonly maxPayloadBytes: number;
	readonly joinTimeoutMs: number;
	readonly heartbeatIntervalMs: number;
	readonly bufferedAmountLimitBytes: number;
	readonly simLatencyMs: number;
	readonly simJitterMs: number;
	readonly simDropRate: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
	const parsed = EnvSchema.safeParse(env);
	if (!parsed.success) {
		console.error("Invalid server configuration:", parsed.error.format());
		process.exit(1);
	}
	const rawOrigins = parsed.data.ALLOWED_ORIGINS.trim();
	const allowedOrigins =
		rawOrigins === "*" || rawOrigins === ""
			? "*"
			: rawOrigins
					.split(",")
					.map((o) => o.trim())
					.filter(Boolean);

	return {
		port: parsed.data.PORT,
		host: parsed.data.HOST,
		nodeEnv: parsed.data.NODE_ENV,
		logLevel: parsed.data.LOG_LEVEL,
		allowedOrigins,
		maxConnectionsPerIp: parsed.data.MAX_CONNECTIONS_PER_IP,
		maxRooms: parsed.data.MAX_ROOMS,
		maxPlayersPerRoom: parsed.data.MAX_PLAYERS_PER_ROOM,
		clientDistDir: path.resolve(process.cwd(), parsed.data.STATIC_DIR),
		logDir: path.resolve(process.cwd(), parsed.data.LOG_DIR),
		appVersion: parsed.data.APP_VERSION,
		maxPayloadBytes: parsed.data.MAX_PAYLOAD_BYTES,
		joinTimeoutMs: parsed.data.JOIN_TIMEOUT_MS,
		heartbeatIntervalMs: parsed.data.HEARTBEAT_INTERVAL_MS,
		bufferedAmountLimitBytes: parsed.data.BUFFERED_AMOUNT_LIMIT_BYTES,
		simLatencyMs: parsed.data.SIM_LATENCY_MS,
		simJitterMs: parsed.data.SIM_JITTER_MS,
		simDropRate: parsed.data.SIM_DROP_RATE,
	};
}
