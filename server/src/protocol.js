export const PROTOCOL_VERSION = 1;

const ALLOWED_TYPES = new Set(["join", "chat", "ping"]);

export function encodeMessage(type, payload = {}) {
	return JSON.stringify({
		v: PROTOCOL_VERSION,
		type,
		t: Date.now(),
		...payload,
	});
}

export function validateIncomingMessage(rawBuffer, maxBytes = 4096) {
	const byteLen = Buffer.byteLength(rawBuffer);
	if (byteLen > maxBytes) {
		return { ok: false, code: 1009, reason: "Message too big" };
	}

	let parsed;
	try {
		parsed = JSON.parse(rawBuffer.toString("utf8"));
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

	if (typeof parsed.type !== "string" || !ALLOWED_TYPES.has(parsed.type)) {
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
		return {
			ok: true,
			msg: {
				type: "chat",
				text: clean,
			},
		};
	}

	return { ok: true, msg: { type: "ping" } };
}
