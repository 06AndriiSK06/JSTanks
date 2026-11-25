import { performance } from "node:perf_hooks";
import client from "prom-client";

export class ServerMetrics {
	public readonly registry = new client.Registry();
	public readonly connectedPlayers: client.Gauge;
	public readonly activeRooms: client.Gauge;
	public readonly messagesTotal: client.Counter;
	public readonly bytesTotal: client.Counter;
	public readonly tickDurationMs: client.Histogram;
	public readonly eventLoopUtilization: client.Gauge;
	public readonly rssBytes: client.Gauge;
	public readonly rejectionsTotal: client.Counter;

	private lastElu = performance.eventLoopUtilization();

	constructor() {
		this.connectedPlayers = new client.Gauge({
			name: "jstanks_connected_players",
			help: "Current number of connected WebSocket players",
			registers: [this.registry],
		});

		this.activeRooms = new client.Gauge({
			name: "jstanks_active_rooms",
			help: "Current number of active game rooms",
			registers: [this.registry],
		});

		this.messagesTotal = new client.Counter({
			name: "jstanks_ws_messages_total",
			help: "Total WebSocket messages processed",
			labelNames: ["direction"] as const,
			registers: [this.registry],
		});

		this.bytesTotal = new client.Counter({
			name: "jstanks_ws_bytes_total",
			help: "Total WebSocket bytes transferred",
			labelNames: ["direction"] as const,
			registers: [this.registry],
		});

		this.tickDurationMs = new client.Histogram({
			name: "jstanks_tick_duration_ms",
			help: "Simulation tick duration in milliseconds",
			buckets: [0.5, 1, 2, 5, 10, 16.6, 25, 33.3, 50],
			registers: [this.registry],
		});

		this.eventLoopUtilization = new client.Gauge({
			name: "jstanks_event_loop_utilization",
			help: "Node.js event loop utilization ratio (0..1)",
			registers: [this.registry],
		});

		this.rssBytes = new client.Gauge({
			name: "jstanks_process_rss_bytes",
			help: "Resident Set Size memory in bytes",
			registers: [this.registry],
		});

		this.rejectionsTotal = new client.Counter({
			name: "jstanks_ws_rejections_total",
			help: "Rejected or disconnected abusive WebSocket clients",
			labelNames: ["reason"] as const,
			registers: [this.registry],
		});
	}

	public sampleRuntime(): { elu: number; rssMb: number } {
		const current = performance.eventLoopUtilization();
		const diff = performance.eventLoopUtilization(current, this.lastElu);
		this.lastElu = current;
		const rss = process.memoryUsage().rss;
		this.eventLoopUtilization.set(diff.utilization);
		this.rssBytes.set(rss);
		return {
			elu: diff.utilization,
			rssMb: Math.round((rss / (1024 * 1024)) * 10) / 10,
		};
	}
}
