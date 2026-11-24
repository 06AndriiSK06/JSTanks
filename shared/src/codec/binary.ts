import type { PlayerInputCommand } from "../protocol.js";
import {
	asEntityId,
	asOwnerSlot,
	asSeq,
	asTick,
	type SnapshotEntity,
	type WorldSnapshot,
} from "../types.js";

export const BIN_VERSION = 1 as const;
export const BIN_MSG_INPUT = 0x01 as const;
export const BIN_MSG_SNAPSHOT = 0x02 as const;

const INPUT_BYTE_LENGTH = 12;
const SNAPSHOT_HEADER_BYTES = 12;
const ENTITY_RECORD_BYTES = 24;

export type ByteBufferInput = ArrayBuffer | ArrayBufferView;

function toUint8Array(buf: ByteBufferInput): Uint8Array {
	if (buf instanceof ArrayBuffer) {
		return new Uint8Array(buf);
	}
	return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function encodeInputBinary(input: PlayerInputCommand): ArrayBuffer {
	const buffer = new ArrayBuffer(INPUT_BYTE_LENGTH);
	const view = new DataView(buffer);

	view.setUint8(0, BIN_VERSION);
	view.setUint8(1, BIN_MSG_INPUT);
	view.setUint32(2, input.seq >>> 0, true);
	view.setInt8(6, input.thrust);
	view.setInt8(7, input.turn);

	let buttons = 0;
	if (input.fire) buttons |= 1;
	if (input.missile) buttons |= 2;
	view.setUint8(8, buttons);
	view.setUint8(9, 0);
	view.setUint16(10, input.clientTick & 0xffff, true);

	return buffer;
}

export function decodeInputBinary(
	bufferLike: ByteBufferInput,
): PlayerInputCommand {
	const bytes = toUint8Array(bufferLike);
	if (bytes.byteLength !== INPUT_BYTE_LENGTH) {
		throw new Error(
			`Invalid binary input length: expected ${INPUT_BYTE_LENGTH}, got ${bytes.byteLength}`,
		);
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const version = view.getUint8(0);
	const msgType = view.getUint8(1);

	if (version !== BIN_VERSION || msgType !== BIN_MSG_INPUT) {
		throw new Error(
			`Invalid binary input header: v=${version}, type=${msgType}`,
		);
	}

	const seq = asSeq(view.getUint32(2, true));
	const rawThrust = view.getInt8(6);
	const rawTurn = view.getInt8(7);
	if (
		(rawThrust !== -1 && rawThrust !== 0 && rawThrust !== 1) ||
		(rawTurn !== -1 && rawTurn !== 0 && rawTurn !== 1)
	) {
		throw new Error(
			`Out-of-range binary axis: thrust=${rawThrust}, turn=${rawTurn}`,
		);
	}

	const buttons = view.getUint8(8);
	const clientTick = view.getUint16(10, true);

	return {
		seq,
		thrust: rawThrust,
		turn: rawTurn,
		fire: (buttons & 1) !== 0,
		missile: (buttons & 2) !== 0,
		clientTick,
	};
}

export function encodeSnapshotBinary(snapshot: WorldSnapshot): ArrayBuffer {
	const entities = snapshot.entities;
	const totalBytes =
		SNAPSHOT_HEADER_BYTES + entities.length * ENTITY_RECORD_BYTES;
	const buffer = new ArrayBuffer(totalBytes);
	const view = new DataView(buffer);

	view.setUint8(0, BIN_VERSION);
	view.setUint8(1, BIN_MSG_SNAPSHOT);
	view.setUint32(2, snapshot.tick >>> 0, true);
	view.setUint32(6, snapshot.lastProcessedSeq >>> 0, true);
	view.setUint16(10, entities.length, true);

	let offset = SNAPSHOT_HEADER_BYTES;
	for (const e of entities) {
		view.setUint16(offset, e.id & 0xffff, true);
		view.setUint8(offset + 2, e.kindCode & 0xff);
		view.setUint8(offset + 3, e.flags & 0xff);
		view.setUint16(offset + 4, e.ownerSlot & 0xffff, true);

		const quantizedAngle = Math.max(
			-32768,
			Math.min(32767, Math.round(e.angle * 1000)),
		);
		view.setInt16(offset + 6, quantizedAngle, true);

		view.setFloat32(offset + 8, e.x, true);
		view.setFloat32(offset + 12, e.y, true);
		view.setInt16(
			offset + 16,
			Math.max(-32768, Math.min(32767, Math.round(e.vx))),
			true,
		);
		view.setInt16(
			offset + 18,
			Math.max(-32768, Math.min(32767, Math.round(e.vy))),
			true,
		);
		view.setUint16(
			offset + 20,
			Math.max(0, Math.min(65535, Math.round(e.hp))),
			true,
		);
		view.setUint16(
			offset + 22,
			Math.max(0, Math.min(65535, Math.round(e.score / 10))),
			true,
		);

		offset += ENTITY_RECORD_BYTES;
	}

	return buffer;
}

export function decodeSnapshotBinary(
	bufferLike: ByteBufferInput,
): WorldSnapshot {
	const bytes = toUint8Array(bufferLike);
	if (bytes.byteLength < SNAPSHOT_HEADER_BYTES) {
		throw new Error("Binary snapshot header too short");
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const version = view.getUint8(0);
	const msgType = view.getUint8(1);

	if (version !== BIN_VERSION || msgType !== BIN_MSG_SNAPSHOT) {
		throw new Error(
			`Invalid binary snapshot header: v=${version}, type=${msgType}`,
		);
	}

	const tick = asTick(view.getUint32(2, true));
	const lastProcessedSeq = asSeq(view.getUint32(6, true));
	const count = view.getUint16(10, true);

	const expectedBytes = SNAPSHOT_HEADER_BYTES + count * ENTITY_RECORD_BYTES;
	if (bytes.byteLength !== expectedBytes) {
		throw new Error(
			`Invalid binary snapshot size: expected ${expectedBytes}, got ${bytes.byteLength}`,
		);
	}

	const entities: SnapshotEntity[] = [];
	let offset = SNAPSHOT_HEADER_BYTES;
	for (let i = 0; i < count; i += 1) {
		const id = asEntityId(view.getUint16(offset, true));
		const kindCode = view.getUint8(offset + 2);
		const flags = view.getUint8(offset + 3);
		const ownerSlot = asOwnerSlot(view.getUint16(offset + 4, true));
		const angle = view.getInt16(offset + 6, true) / 1000;
		const x = view.getFloat32(offset + 8, true);
		const y = view.getFloat32(offset + 12, true);
		const vx = view.getInt16(offset + 16, true);
		const vy = view.getInt16(offset + 18, true);
		const hp = view.getUint16(offset + 20, true);
		const score = view.getUint16(offset + 22, true) * 10;

		const base = { id, ownerSlot, x, y, vx, vy, angle, hp, score, flags };

		switch (kindCode) {
			case 1:
				entities.push({ ...base, kind: "ship", kindCode: 1 });
				break;
			case 2:
				entities.push({ ...base, kind: "bullet", kindCode: 2 });
				break;
			case 3:
				entities.push({ ...base, kind: "asteroid", kindCode: 3 });
				break;
			case 4:
				entities.push({ ...base, kind: "pickup", kindCode: 4 });
				break;
			default:
				throw new Error(`Unknown binary entity kindCode: ${kindCode}`);
		}

		offset += ENTITY_RECORD_BYTES;
	}

	return {
		type: "snapshot",
		tick,
		lastProcessedSeq,
		entities,
	};
}

export interface SnapshotCodec {
	readonly name: "binary" | "json";
	encode(snapshot: WorldSnapshot): ArrayBuffer | string;
}

export const BinarySnapshotCodec: SnapshotCodec = {
	name: "binary",
	encode: encodeSnapshotBinary,
};

export const JsonSnapshotCodec: SnapshotCodec = {
	name: "json",
	encode: (snapshot: WorldSnapshot) => JSON.stringify(snapshot),
};
