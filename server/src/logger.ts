import pino from "pino";

export function createLogger(level = process.env.LOG_LEVEL ?? "info") {
	return pino({
		level,
		redact: {
			paths: [
				"password",
				"token",
				"secret",
				"apiKey",
				"authorization",
				"*.password",
				"*.token",
				"*.secret",
			],
			censor: "[REDACTED]",
		},
		base: {
			service: "jstanks-server",
			version: process.env.APP_VERSION ?? process.env.GIT_SHA ?? "dev",
		},
		timestamp: pino.stdTimeFunctions.isoTime,
	});
}

export type Logger = ReturnType<typeof createLogger>;
