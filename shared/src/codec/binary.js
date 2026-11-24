/**
 * Бінарний протокол JSTanks v1 (Little-Endian)
 *
 * 1) Клієнтський INPUT (12 байт):
 *    offset 0  (Uint8)  : version = 1
 *    offset 1  (Uint8)  : msgType = 0x01 (INPUT)
 *    offset 2  (Uint32) : seq (номер послідовності інпуту)
 *    offset 6  (Int8)   : thrust (-1, 0, 1)
 *    offset 7  (Int8)   : turn (-1, 0, 1)
 *    offset 8  (Uint8)  : buttons bitmask (bit 0 = fire, bit 1 = missile)
 *    offset 9  (Uint8)  : reserved (0)
 *    offset 10 (Uint16) : clientTick
 *
 * 2) Серверний SNAPSHOT (12 байт заголовок + 24 байти на сутність):
 *    Заголовок (12 байт):
 *      offset 0  (Uint8)  : version = 1
 *      offset 1  (Uint8)  : msgType = 0x02 (SNAPSHOT)
 *      offset 2  (Uint32) : serverTick
 *      offset 6  (Uint32) : lastProcessedSeq
 *      offset 10 (Uint16) : entityCount
 *    Запис сутності (24 байти):
 *      offset +0  (Uint16) : entityId
 *      offset +2  (Uint8)  : kindCode (1=ship, 2=bullet, 3=asteroid, 4=pickup)
 *      offset +3  (Uint8)  : flags bitmask
 *      offset +4  (Uint16) : ownerSlot (числовий індекс власника 0..65535)
 *      offset +6  (Int16)  : angle quantized (Math.round(angle * 1000), крок 0.001 рад)
 *      offset +8  (Float32): x
 *      offset +12 (Float32): y
 *      offset +16 (Int16)  : vx (пікселів/с)
 *      offset +18 (Int16)  : vy (пікселів/с)
 *      offset +20 (Uint16) : hp
 *      offset +22 (Uint16) : score (десятки очок, score / 10)
 */

import { KIND_FROM_CODE } from "../sim/entities.js";

export const BIN_VERSION = 1;
export const BIN_MSG_INPUT = 0x01;
export const BIN_MSG_SNAPSHOT = 0x02;

const INPUT_BYTE_LENGTH = 12;
const SNAPSHOT_HEADER_BYTES = 12;
const ENTITY_RECORD_BYTES = 24;

export function encodeInputBinary(input) {
	const buffer = new ArrayBuffer(INPUT_BYTE_LENGTH);
	const view = new DataView(buffer);

	view.setUint8(0, BIN_VERSION);
	view.setUint8(1, BIN_MSG_INPUT);
	view.setUint32(2, input.seq >>> 0, true);
	view.setInt8(6, Math.max(-1, Math.min(1, Math.round(input.thrust || 0))));
	view.setInt8(7, Math.max(-1, Math.min(1, Math.round(input.turn || 0))));

	let buttons = 0;
	if (input.fire) buttons |= 1;
	if (input.missile) buttons |= 2;
	view.setUint8(8, buttons);
	view.setUint8(9, 0);
	view.setUint16(10, (input.clientTick || 0) & 0xffff, true);

	return buffer;
}

export function decodeInputBinary(bufferLike) {
	const bytes =
		bufferLike instanceof ArrayBuffer
			? new Uint8Array(bufferLike)
			: new Uint8Array(
					bufferLike.buffer,
					bufferLike.byteOffset,
					bufferLike.byteLength,
				);

	if (bytes.byteLength < INPUT_BYTE_LENGTH) {
		throw new Error("Binary input frame too short");
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const version = view.getUint8(0);
	const msgType = view.getUint8(1);

	if (version !== BIN_VERSION || msgType !== BIN_MSG_INPUT) {
		throw new Error(
			`Invalid binary input header: v=${version}, type=${msgType}`,
		);
	}

	const seq = view.getUint32(2, true);
	const thrust = view.getInt8(6);
	const turn = view.getInt8(7);
	const buttons = view.getUint8(8);
	const clientTick = view.getUint16(10, true);

	return {
		type: "input",
		seq,
		thrust,
		turn,
		fire: (buttons & 1) !== 0,
		missile: (buttons & 2) !== 0,
		clientTick,
	};
}

export function encodeSnapshotBinary(snapshot) {
	const entities = snapshot.entities ?? [];
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
		view.setUint8(offset + 3, (e.flags ?? 0) & 0xff);
		view.setUint16(offset + 4, (e.ownerSlot ?? 0) & 0xffff, true);

		const quantizedAngle = Math.max(
			-32768,
			Math.min(32767, Math.round((e.angle ?? 0) * 1000)),
		);
		view.setInt16(offset + 6, quantizedAngle, true);

		view.setFloat32(offset + 8, e.x ?? 0, true);
		view.setFloat32(offset + 12, e.y ?? 0, true);
		view.setInt16(
			offset + 16,
			Math.max(-32768, Math.min(32767, Math.round(e.vx ?? 0))),
			true,
		);
		view.setInt16(
			offset + 18,
			Math.max(-32768, Math.min(32767, Math.round(e.vy ?? 0))),
			true,
		);
		view.setUint16(
			offset + 20,
			Math.max(0, Math.min(65535, Math.round(e.hp ?? 0))),
			true,
		);
		view.setUint16(
			offset + 22,
			Math.max(0, Math.min(65535, Math.round((e.score ?? 0) / 10))),
			true,
		);

		offset += ENTITY_RECORD_BYTES;
	}

	return buffer;
}

export function decodeSnapshotBinary(bufferLike) {
	const bytes =
		bufferLike instanceof ArrayBuffer
			? new Uint8Array(bufferLike)
			: new Uint8Array(
					bufferLike.buffer,
					bufferLike.byteOffset,
					bufferLike.byteLength,
				);

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

	const tick = view.getUint32(2, true);
	const lastProcessedSeq = view.getUint32(6, true);
	const count = view.getUint16(10, true);

	const expectedBytes = SNAPSHOT_HEADER_BYTES + count * ENTITY_RECORD_BYTES;
	if (bytes.byteLength < expectedBytes) {
		throw new Error(
			`Truncated binary snapshot: expected ${expectedBytes}, got ${bytes.byteLength}`,
		);
	}

	const entities = [];
	let offset = SNAPSHOT_HEADER_BYTES;
	for (let i = 0; i < count; i += 1) {
		const id = view.getUint16(offset, true);
		const kindCode = view.getUint8(offset + 2);
		const flags = view.getUint8(offset + 3);
		const ownerSlot = view.getUint16(offset + 4, true);
		const angle = view.getInt16(offset + 6, true) / 1000;
		const x = view.getFloat32(offset + 8, true);
		const y = view.getFloat32(offset + 12, true);
		const vx = view.getInt16(offset + 16, true);
		const vy = view.getInt16(offset + 18, true);
		const hp = view.getUint16(offset + 20, true);
		const score = view.getUint16(offset + 22, true) * 10;

		entities.push({
			id,
			kindCode,
			kind: KIND_FROM_CODE[kindCode] ?? "unknown",
			flags,
			ownerSlot,
			angle,
			x,
			y,
			vx,
			vy,
			hp,
			score,
		});

		offset += ENTITY_RECORD_BYTES;
	}

	return {
		type: "snapshot",
		tick,
		lastProcessedSeq,
		entities,
	};
}
