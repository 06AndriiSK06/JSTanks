import path from "node:path";
import { z } from "zod";

const EnvSchema = z.object({
	PORT: z.coerce.number().int().positive().max(65535).default(3000),
	HOST: z.string().trim().min(1).default("0.0.0.0"),
	LOG_DIR: z.string().trim().min(1).default("./logs"),
	MAX_ROOMS: z.coerce.number().int().positive().max(200).default(20),
	MAX_PLAYERS_PER_ROOM: z.coerce
		.number()
		.int()
		.positive()
		.max(256)
		.default(160),
	SIM_LATENCY_MS: z.coerce.number().min(0).max(1000).default(0),
	SIM_JITTER_MS: z.coerce.number().min(0).max(500).default(0),
	SIM_DROP_RATE: z.coerce.number().min(0).max(0.5).default(0),
});

export interface ServerConfig {
	readonly port: number;
	readonly host: string;
	readonly logDir: string;
	readonly clientDistDir: string;
	readonly maxRooms: number;
	readonly maxPlayersPerRoom: number;
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
		const issues = parsed.error.issues
			.map((i) => `${i.path.join(".")}: ${i.message}`)
			.join("; ");
		throw new Error(`Invalid environment configuration: ${issues}`);
	}

	const data = parsed.data;
	return {
		port: data.PORT,
		host: data.HOST,
		logDir: path.resolve(import.meta.dirname, "..", data.LOG_DIR),
		clientDistDir: path.resolve(import.meta.dirname, "../../client/dist"),
		maxRooms: data.MAX_ROOMS,
		maxPlayersPerRoom: data.MAX_PLAYERS_PER_ROOM,
		maxPayloadBytes: 4096,
		joinTimeoutMs: 5000,
		heartbeatIntervalMs: 15000,
		bufferedAmountLimitBytes: 64 * 1024,
		simLatencyMs: data.SIM_LATENCY_MS,
		simJitterMs: data.SIM_JITTER_MS,
		simDropRate: data.SIM_DROP_RATE,
	} satisfies ServerConfig;
}
