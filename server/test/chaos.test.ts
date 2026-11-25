import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";

const SERVER_ENTRY = path.resolve(import.meta.dirname, "../src/index.ts");

function startTestServer(extraEnv: Record<string, string>) {
	return spawn(process.execPath, ["--import", "tsx", SERVER_ENTRY], {
		env: {
			...process.env,
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			...extraEnv,
		},
		stdio: "ignore",
	});
}

async function waitHealthy(baseUrl: string): Promise<void> {
	for (let i = 0; i < 40; i += 1) {
		try {
			const res = await fetch(`${baseUrl}/health`);
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 150));
	}
	throw new Error("Server did not become healthy in time");
}

describe("Production hardening, chaos & observability (Lab 8)", () => {
	it("enforces Origin check, per-IP cap, isolates garbage flood and exposes /health, /ready, /metrics", async () => {
		const port = 3891;
		const baseUrl = `http://127.0.0.1:${port}`;
		const wsUrl = `ws://127.0.0.1:${port}/ws`;

		const child = startTestServer({
			PORT: String(port),
			ALLOWED_ORIGINS: "https://jstanks.example.com",
			MAX_CONNECTIONS_PER_IP: "3",
			APP_VERSION: "v1.0.0-test",
		});

		try {
			await waitHealthy(baseUrl);

			// 1. /health and /ready
			const healthRes = await fetch(`${baseUrl}/health`);
			const healthJson = (await healthRes.json()) as {
				status: string;
				version: string;
			};
			expect(healthJson.status).toBe("ok");
			expect(healthJson.version).toBe("v1.0.0-test");

			const readyRes = await fetch(`${baseUrl}/ready`);
			expect(readyRes.status).toBe(200);

			// 2. Reject invalid Origin on WebSocket handshake
			await expect(
				new Promise<void>((resolve, reject) => {
					const badWs = new WebSocket(wsUrl, {
						headers: { Origin: "https://evil-site.example.org" },
					});
					badWs.on("open", () => {
						badWs.close();
						reject(new Error("Should not allow invalid origin"));
					});
					badWs.on("unexpected-response", (_req, res) => {
						expect(res.statusCode).toBe(403);
						resolve();
					});
					badWs.on("error", () => resolve());
				}),
			).resolves.toBeUndefined();

			// 3. Connect 3 valid clients (reaching MAX_CONNECTIONS_PER_IP = 3)
			const validHeaders = { Origin: "https://jstanks.example.com" };
			const connectValid = (name: string, room: string) =>
				new Promise<WebSocket>((resolve, reject) => {
					const ws = new WebSocket(wsUrl, { headers: validHeaders });
					ws.on("open", () => {
						ws.send(
							JSON.stringify({ type: "join", room, name, codec: "json" }),
						);
						resolve(ws);
					});
					ws.on("error", reject);
				});

			const healthyPlayer = await connectValid("HealthyPilot", "alpha-room");
			const observerPlayer = await connectValid("ObserverPilot", "alpha-room");
			const flooder = await connectValid("FloodBot", "chaos-room");

			// 4th connection from same IP must be rejected with 429
			await expect(
				new Promise<void>((resolve, reject) => {
					const extraWs = new WebSocket(wsUrl, { headers: validHeaders });
					extraWs.on("open", () => {
						extraWs.close();
						reject(new Error("Should reject 4th connection from same IP"));
					});
					extraWs.on("unexpected-response", (_req, res) => {
						expect(res.statusCode).toBe(429);
						resolve();
					});
					extraWs.on("error", () => resolve());
				}),
			).resolves.toBeUndefined();

			// 4. Chaos test: flooder sends garbage frames rapidly; server disconnects it without affecting alpha-room
			const flooderClosed = new Promise<number>((resolve) => {
				flooder.on("close", (code) => resolve(code));
			});
			for (let i = 0; i < 120; i += 1) {
				if (flooder.readyState === WebSocket.OPEN) {
					flooder.send("{corrupted_json_frame!!!");
				}
			}
			const closeCode = await flooderClosed;
			expect([1007, 1008]).toContain(closeCode);

			// 5. Verify Prometheus /metrics and alpha-room tick isolation (< 33.3ms)
			const metricsRes = await fetch(`${baseUrl}/metrics`);
			const metricsText = await metricsRes.text();
			expect(metricsText).toContain("jstanks_connected_players");
			expect(metricsText).toContain("jstanks_ws_rejections_total");

			const statsRes = await fetch(`${baseUrl}/api/stats`);
			const stats = (await statsRes.json()) as {
				rooms: Array<{ id: string; p99DurationMs: number }>;
			};
			const alphaStat = stats.rooms.find((r) => r.id === "alpha-room");
			expect((alphaStat?.p99DurationMs ?? 0) < 33.3).toBe(true);

			healthyPlayer.close();
			observerPlayer.close();
		} finally {
			child.kill();
		}
	}, 15000);
});
