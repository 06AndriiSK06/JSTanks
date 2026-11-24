export type EntityId = number & { readonly __brand: "EntityId" };
export type Tick = number & { readonly __brand: "Tick" };
export type Seq = number & { readonly __brand: "Seq" };
export type OwnerSlot = number & { readonly __brand: "OwnerSlot" };

export function asEntityId(n: number): EntityId {
	return n as EntityId; // єдиний конструктор branded EntityId
}

export function asTick(n: number): Tick {
	return n as Tick; // єдиний конструктор branded Tick
}

export function asSeq(n: number): Seq {
	return n as Seq; // єдиний конструктор branded Seq
}

export function asOwnerSlot(n: number): OwnerSlot {
	return n as OwnerSlot; // єдиний конструктор branded OwnerSlot
}

export interface ArenaBounds {
	readonly width: number;
	readonly height: number;
}

export interface BaseEntitySnapshot {
	readonly id: EntityId;
	readonly ownerSlot: OwnerSlot;
	readonly x: number;
	readonly y: number;
	readonly vx: number;
	readonly vy: number;
	readonly angle: number;
	readonly hp: number;
	readonly score: number;
	readonly flags: number;
}

export interface ShipSnapshotEntity extends BaseEntitySnapshot {
	readonly kind: "ship";
	readonly kindCode: 1;
	readonly ownerId?: string;
	readonly name?: string;
}

export interface BulletSnapshotEntity extends BaseEntitySnapshot {
	readonly kind: "bullet";
	readonly kindCode: 2;
	readonly ownerId?: string;
}

export interface AsteroidSnapshotEntity extends BaseEntitySnapshot {
	readonly kind: "asteroid";
	readonly kindCode: 3;
}

export interface PickupSnapshotEntity extends BaseEntitySnapshot {
	readonly kind: "pickup";
	readonly kindCode: 4;
}

export type SnapshotEntity =
	| ShipSnapshotEntity
	| BulletSnapshotEntity
	| AsteroidSnapshotEntity
	| PickupSnapshotEntity;

export interface WorldSnapshot {
	readonly type: "snapshot";
	readonly tick: Tick;
	readonly lastProcessedSeq: Seq;
	readonly entities: readonly SnapshotEntity[];
}

export type SimGameEvent =
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
