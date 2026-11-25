import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: [
			"shared/test/**/*.test.ts",
			"server/test/**/*.test.ts",
			"client/test/**/*.test.ts",
		],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["shared/src/**/*.ts"],
			exclude: ["shared/src/index.ts", "shared/src/types.ts"],
			thresholds: {
				lines: 85,
				functions: 85,
				statements: 85,
			},
		},
	},
});
