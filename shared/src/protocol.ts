import { z } from "zod";
import { asSeq, type Seq } from "./types.js";

export const PROTOCOL_VERSION = 1 as const;

export const ClientJoinSchema = z.object({
	v: z.literal(PROTOCOL_VERSION).optional(),
	type: z.literal("join"),
	room: z.string().trim().min(1).max(48),
	name: z.string().trim().min(1).max(24),
	codec: z.enum(["binary", "json"]).default("binary"),
});

export const ClientChatSchema = z.object({
	v: z.literal(PROTOCOL_VERSION).optional(),
	type: z.literal("chat"),
	text: z.string().trim().min(1).max(280),
});

export const ClientInputSchema = z.object({
	v: z.literal(PROTOCOL_VERSION).optional(),
	type: z.literal("input"),
	seq: z.number().int().nonnegative(),
	thrust: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
	turn: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
	fire: z.boolean(),
	missile: z.boolean(),
	clientTick: z.number().int().nonnegative().default(0),
});

export const ClientPingSchema = z.object({
	v: z.literal(PROTOCOL_VERSION).optional(),
	type: z.literal("ping"),
	clientTime: z.number().nonnegative().default(0),
});

export const ClientNetSimSchema = z.object({
	v: z.literal(PROTOCOL_VERSION).optional(),
	type: z.literal("netSim"),
	latencyMs: z.number().min(0).max(1000),
	jitterMs: z.number().min(0).max(500),
	dropRate: z.number().min(0).max(0.5),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
	ClientJoinSchema,
	ClientChatSchema,
	ClientInputSchema,
	ClientPingSchema,
	ClientNetSimSchema,
]);

export type ClientJoinMessage = z.infer<typeof ClientJoinSchema>;
export type ClientChatMessage = z.infer<typeof ClientChatSchema>;
export type ClientInputRaw = z.infer<typeof ClientInputSchema>;
export type ClientPingMessage = z.infer<typeof ClientPingSchema>;
export type ClientNetSimMessage = z.infer<typeof ClientNetSimSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export interface PlayerInputCommand {
	readonly seq: Seq;
	readonly thrust: -1 | 0 | 1;
	readonly turn: -1 | 0 | 1;
	readonly fire: boolean;
	readonly missile: boolean;
	readonly clientTick: number;
}

export function toPlayerInputCommand(raw: ClientInputRaw): PlayerInputCommand {
	return {
		seq: asSeq(raw.seq),
		thrust: raw.thrust,
		turn: raw.turn,
		fire: raw.fire,
		missile: raw.missile,
		clientTick: raw.clientTick,
	};
}

export type ParseClientResult =
	| { readonly ok: true; readonly msg: ClientMessage }
	| { readonly ok: false; readonly code: number; readonly reason: string };

export function parseClientMessage(rawUnknown: unknown): ParseClientResult {
	let candidate: unknown = rawUnknown;

	if (typeof rawUnknown === "string") {
		try {
			candidate = JSON.parse(rawUnknown);
		} catch {
			return { ok: false, code: 1007, reason: "Invalid JSON payload" };
		}
	}

	const parsed = ClientMessageSchema.safeParse(candidate);
	if (!parsed.success) {
		const firstIssue = parsed.error.issues[0];
		const detail = firstIssue
			? `${firstIssue.path.join(".")}: ${firstIssue.message}`
			: "Invalid message";
		return {
			ok: false,
			code: 1008,
			reason: `Schema validation failed (${detail})`,
		};
	}

	return { ok: true, msg: parsed.data };
}

export interface RosterPlayerInfo {
	readonly id: string;
	readonly ownerSlot: number;
	readonly name: string;
	readonly joinedAt: number;
}

export interface RoomSummaryInfo {
	readonly id: string;
	readonly name: string;
	readonly players: number;
	readonly maxPlayers: number;
	readonly initialAsteroids: number;
	readonly difficulty: string;
	readonly seed: number;
	readonly arena: { readonly width: number; readonly height: number };
}

export type ServerJsonMessage =
	| {
			readonly v: typeof PROTOCOL_VERSION;
			readonly type: "welcome";
			readonly t: number;
			readonly playerId: string;
			readonly ownerSlot: number;
			readonly codec: "binary" | "json";
			readonly room: RoomSummaryInfo;
			readonly players: readonly RosterPlayerInfo[];
	  }
	| {
			readonly v: typeof PROTOCOL_VERSION;
			readonly type: "roster";
			readonly t: number;
			readonly players: readonly RosterPlayerInfo[];
			readonly systemNotice?: string;
	  }
	| {
			readonly v: typeof PROTOCOL_VERSION;
			readonly type: "chat";
			readonly t: number;
			readonly playerId: string;
			readonly name: string;
			readonly text: string;
	  }
	| {
			readonly v: typeof PROTOCOL_VERSION;
			readonly type: "pong";
			readonly t: number;
			readonly clientTime: number;
	  }
	| {
			readonly v: typeof PROTOCOL_VERSION;
			readonly type: "gameEvent";
			readonly t: number;
			readonly event:
				| {
						readonly type: "fired";
						readonly ownerId: string;
						readonly isMissile: boolean;
				  }
				| { readonly type: "hit"; readonly kind: "asteroid" | "ship" }
				| {
						readonly type: "exploded";
						readonly kind: "asteroid" | "ship";
						readonly x: number;
						readonly y: number;
				  }
				| {
						readonly type: "pickup";
						readonly ownerId: string;
						readonly pickupType: "shield" | "rapid";
				  };
	  };

export const ServerMessageSchema = z.object({
	v: z.number().optional(),
	type: z.enum([
		"welcome",
		"roster",
		"chat",
		"pong",
		"gameEvent",
		"netSimUpdated",
	]),
});
