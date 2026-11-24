import { decodeInputBinary } from "@jstanks/shared";

export const PROTOCOL_VERSION = 1;

const ALLOWED_JSON_TYPES = new Set(["join", "chat", "ping", "input", "netSim"]);

export function encodeMessage(type, payload = {}) {
	return JSON.stringify({
		v: PROTOCOL_VERSION,
		type,
		t: Date.now(),
		...payload,
	});
}

export function validateIncomingMessage(rawData, isBinary, maxBytes = 4096) {
	const byteLen = Buffer.byteLength(rawData);
	if (byteLen > maxBytes) {
		return { ok: false, code: 1009, reason: "Message too big" };
	}

	if (isBinary) {
		try {
			const msg = decodeInputBinary(rawData);
			return { ok: true, msg, isBinary: true };
		} catch (err) {
			return { ok: false, code: 1007, reason: err.message };
		}
	}

	let parsed;
	try {
		parsed = JSON.parse(rawData.toString("utf8"));
	} catch {
		return { ok: false, code: 1007, reason: "Invalid JSON payload" };
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, code: 1003, reason: "Message must be a JSON object" };
	}

	if (parsed.v !== undefined && parsed.v !== PROTOCOL_VERSION) {
		return {
			ok: false,
			code: 1002,
			reason: `Unsupported protocol version: ${parsed.v}`,
		};
	}

	if (typeof parsed.type !== "string" || !ALLOWED_JSON_TYPES.has(parsed.type)) {
		return {
			ok: false,
			code: 1003,
			reason: `Unknown message type: ${String(parsed.type)}`,
		};
	}

	if (parsed.type === "join") {
		if (
			typeof parsed.room !== "string" ||
			parsed.room.trim().length === 0 ||
			parsed.room.length > 48
		) {
			return {
				ok: false,
				code: 1007,
				reason: "Invalid room id in join message",
			};
		}
		if (
			typeof parsed.name !== "string" ||
			parsed.name.trim().length === 0 ||
			parsed.name.length > 24
		) {
			return {
				ok: false,
				code: 1007,
				reason: "Invalid player name in join message",
			};
		}
		return {
			ok: true,
			msg: {
				type: "join",
				room: parsed.room.trim(),
				name: parsed.name.trim(),
				codec: parsed.codec === "json" ? "json" : "binary",
			},
		};
	}

	if (parsed.type === "chat") {
		if (typeof parsed.text !== "string") {
			return { ok: false, code: 1007, reason: "Chat text must be a string" };
		}
		const clean = parsed.text.trim();
		if (clean.length === 0 || clean.length > 280) {
			return {
				ok: false,
				code: 1007,
				reason: "Chat text must be 1..280 characters",
			};
		}
		return { ok: true, msg: { type: "chat", text: clean } };
	}

	if (parsed.type === "input") {
		const seq = Number(parsed.seq);
		if (!Number.isInteger(seq) || seq < 0) {
			return { ok: false, code: 1007, reason: "Invalid input seq" };
		}
		const thrust = Number(parsed.thrust) || 0;
		const turn = Number(parsed.turn) || 0;
		if (Math.abs(thrust) > 1 || Math.abs(turn) > 1) {
			return {
				ok: false,
				code: 1008,
				reason: "Cheat detected: out-of-range input axis",
			};
		}
		return {
			ok: true,
			msg: {
				type: "input",
				seq,
				thrust: Math.round(thrust),
				turn: Math.round(turn),
				fire: Boolean(parsed.fire),
				missile: Boolean(parsed.missile),
				clientTick: Number(parsed.clientTick) || 0,
			},
		};
	}

	if (parsed.type === "netSim") {
		return {
			ok: true,
			msg: {
				type: "netSim",
				latencyMs: Math.max(0, Math.min(1000, Number(parsed.latencyMs) || 0)),
				jitterMs: Math.max(0, Math.min(500, Number(parsed.jitterMs) || 0)),
				dropRate: Math.max(0, Math.min(0.5, Number(parsed.dropRate) || 0)),
			},
		};
	}

	return {
		ok: true,
		msg: {
			type: "ping",
			clientTime: Number(parsed.clientTime) || Date.now(),
		},
	};
}
