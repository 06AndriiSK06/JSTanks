import {
	type ArenaBounds,
	asOwnerSlot,
	asSeq,
	asTick,
	type OwnerSlot,
	type PlayerInputCommand,
	type RosterPlayerInfo,
	type Seq,
	SimShip,
	type SnapshotEntity,
	type Tick,
	Vector2,
	type WorldSnapshot,
} from "@jstanks/shared";

const SERVER_DT = 1 / 30;

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
	let diff = b - a;
	while (diff > Math.PI) diff -= Math.PI * 2;
	while (diff < -Math.PI) diff += Math.PI * 2;
	return a + diff * t;
}

export type RenderEntity =
	| {
			readonly kind: "ship";
			readonly isLocal: boolean;
			readonly name: string;
			readonly x: number;
			readonly y: number;
			readonly angle: number;
			readonly hp: number;
			readonly isSpawned: boolean;
			readonly shieldTimer: number;
			readonly rapidFireTimer: number;
			readonly thrusting: boolean;
	  }
	| {
			readonly kind: "bullet";
			readonly x: number;
			readonly y: number;
			readonly angle: number;
			readonly isMissile: boolean;
	  }
	| {
			readonly kind: "asteroid";
			readonly x: number;
			readonly y: number;
			readonly angle: number;
			readonly size: 1 | 2;
			readonly isSeeker: boolean;
	  }
	| {
			readonly kind: "pickup";
			readonly x: number;
			readonly y: number;
			readonly pickupType: "shield" | "rapid";
	  };

interface BufferedSnapshot {
	readonly receivedAt: number;
	readonly tick: Tick;
	readonly entities: readonly SnapshotEntity[];
}

interface PendingInput extends PlayerInputCommand {
	readonly dt: number;
}

interface LocalBullet {
	readonly seq: Seq;
	x: number;
	y: number;
	readonly vx: number;
	readonly vy: number;
	readonly angle: number;
	readonly isMissile: boolean;
	ttl: number;
}

export class NetworkSession {
	arena: ArenaBounds;
	localPlayerId = "";
	localOwnerSlot: OwnerSlot = asOwnerSlot(0);
	readonly playerNamesBySlot = new Map<number, string>();

	predictionEnabled = true;
	breakDeterminism = false;
	interpolationDelayMs = 75;

	localShip: SimShip | null = null;
	visualOffset = new Vector2(0, 0);
	pendingInputs: PendingInput[] = [];
	private nextSeqNum = 1;
	lastAckSeq: Seq = asSeq(0);
	lastCorrectionPx = 0;

	private localBullets: LocalBullet[] = [];
	private readonly snapshotBuffer: BufferedSnapshot[] = [];
	private lastSnapshotReceivedAt = 0;
	serverTick: Tick = asTick(0);

	constructor(params: { arenaWidth?: number; arenaHeight?: number } = {}) {
		this.arena = {
			width: params.arenaWidth ?? 1200,
			height: params.arenaHeight ?? 760,
		};
	}

	setIdentity(params: {
		playerId: string;
		ownerSlot: number;
		roster?: readonly RosterPlayerInfo[];
		arena?: ArenaBounds;
	}): void {
		this.localPlayerId = params.playerId;
		this.localOwnerSlot = asOwnerSlot(params.ownerSlot);
		if (params.arena) {
			this.arena = { width: params.arena.width, height: params.arena.height };
		}
		if (params.roster) {
			this.updateRoster(params.roster);
		}
	}

	updateRoster(roster: readonly RosterPlayerInfo[]): void {
		this.playerNamesBySlot.clear();
		for (const p of roster) {
			this.playerNamesBySlot.set(p.ownerSlot, p.name);
		}
	}

	stepLocalPrediction(
		dt: number,
		rawControls: {
			thrust: -1 | 0 | 1;
			turn: -1 | 0 | 1;
			fire: boolean;
			missile: boolean;
		},
	): PlayerInputCommand {
		for (const b of this.localBullets) {
			b.ttl -= dt;
			b.x = (b.x + b.vx * dt + this.arena.width) % this.arena.width;
			b.y = (b.y + b.vy * dt + this.arena.height) % this.arena.height;
		}
		this.localBullets = this.localBullets.filter((b) => b.ttl > 0);

		const decay = Math.exp(-dt / 0.08);
		this.visualOffset = this.visualOffset.scale(decay);

		const seq = asSeq(this.nextSeqNum++);
		const input: PlayerInputCommand = {
			seq,
			thrust: rawControls.thrust,
			turn: rawControls.turn,
			fire: rawControls.fire,
			missile: rawControls.missile,
			clientTick: this.serverTick,
		};

		if (this.localShip && this.predictionEnabled) {
			const shot = this.localShip.applyInput(input, dt, this.arena);

			if (this.breakDeterminism) {
				this.localShip.pos = new Vector2(
					this.localShip.pos.x + (Math.random() - 0.5) * 18,
					this.localShip.pos.y + (Math.random() - 0.5) * 18,
				);
			}

			if (shot) {
				const muzzleDist = this.localShip.radius + 10;
				const speed = shot.isMissile ? 340 : 520;
				this.localBullets.push({
					seq,
					x: this.localShip.pos.x + Math.cos(this.localShip.angle) * muzzleDist,
					y: this.localShip.pos.y + Math.sin(this.localShip.angle) * muzzleDist,
					vx:
						Math.cos(this.localShip.angle) * speed +
						this.localShip.vel.x * 0.25,
					vy:
						Math.sin(this.localShip.angle) * speed +
						this.localShip.vel.y * 0.25,
					angle: this.localShip.angle,
					isMissile: shot.isMissile,
					ttl: 0.35,
				});
			}

			this.pendingInputs.push({ ...input, dt });
			if (this.pendingInputs.length > 90) {
				this.pendingInputs.shift();
			}
		}

		return input;
	}

	onSnapshot(snapshot: WorldSnapshot): void {
		const now = performance.now();
		this.lastSnapshotReceivedAt = now;
		this.serverTick = snapshot.tick;
		this.lastAckSeq = snapshot.lastProcessedSeq;

		this.localBullets = this.localBullets.filter(
			(b) => b.seq > this.lastAckSeq,
		);

		this.snapshotBuffer.push({
			receivedAt: now,
			tick: snapshot.tick,
			entities: snapshot.entities,
		});
		if (this.snapshotBuffer.length > 30) {
			this.snapshotBuffer.shift();
		}

		const authShip = snapshot.entities.find(
			(e): e is Extract<SnapshotEntity, { kind: "ship" }> =>
				e.kind === "ship" && e.ownerSlot === this.localOwnerSlot,
		);
		if (!authShip) return;

		if (!this.localShip) {
			this.localShip = new SimShip({
				id: authShip.id,
				ownerId: this.localPlayerId,
				ownerSlot: this.localOwnerSlot,
				name: this.playerNamesBySlot.get(this.localOwnerSlot) ?? "Pilot",
				x: authShip.x,
				y: authShip.y,
				angle: authShip.angle,
			});
		}

		const beforePos = this.localShip.pos.clone();

		this.localShip.id = authShip.id;
		this.localShip.pos = new Vector2(authShip.x, authShip.y);
		this.localShip.vel = new Vector2(authShip.vx, authShip.vy);
		this.localShip.angle = authShip.angle;
		this.localShip.hp = authShip.hp;
		this.localShip.score = authShip.score;
		this.localShip.respawnTimer = (authShip.flags & 1) !== 0 ? 0 : 1.5;
		this.localShip.shieldTimer = (authShip.flags & 2) !== 0 ? 1.0 : 0;
		this.localShip.rapidFireTimer = (authShip.flags & 4) !== 0 ? 1.0 : 0;
		this.localShip.thrusting = (authShip.flags & 8) !== 0;

		this.pendingInputs = this.pendingInputs.filter(
			(inp) => inp.seq > this.lastAckSeq,
		);

		if (this.predictionEnabled) {
			for (const inp of this.pendingInputs) {
				this.localShip.applyInput(inp, inp.dt ?? SERVER_DT, this.arena);
			}

			const errorVec = beforePos.sub(this.localShip.pos);
			const errDist = errorVec.length();
			this.lastCorrectionPx = errDist;

			if (errDist > 0.5 && errDist < 240) {
				this.visualOffset = this.visualOffset.add(errorVec);
			} else if (errDist >= 240) {
				this.visualOffset = new Vector2(0, 0);
			}
		} else {
			this.pendingInputs.length = 0;
			this.lastCorrectionPx = 0;
			this.visualOffset = new Vector2(0, 0);
		}
	}

	getRenderEntities(): RenderEntity[] {
		const result: RenderEntity[] = [];
		const now = performance.now();

		if (this.localShip) {
			result.push({
				kind: "ship",
				isLocal: true,
				name: this.localShip.name,
				x: this.localShip.pos.x + this.visualOffset.x,
				y: this.localShip.pos.y + this.visualOffset.y,
				angle: this.localShip.angle,
				hp: this.localShip.hp,
				isSpawned: this.localShip.isSpawned(),
				shieldTimer: this.localShip.shieldTimer,
				rapidFireTimer: this.localShip.rapidFireTimer,
				thrusting: this.localShip.thrusting,
			});
		}

		for (const lb of this.localBullets) {
			result.push({
				kind: "bullet",
				x: lb.x,
				y: lb.y,
				angle: lb.angle,
				isMissile: lb.isMissile,
			});
		}

		const firstSnap = this.snapshotBuffer[0];
		const lastSnap = this.snapshotBuffer[this.snapshotBuffer.length - 1];
		if (!firstSnap || !lastSnap) {
			return result;
		}

		const renderTime = now - this.interpolationDelayMs;
		let prevSnap = firstSnap;
		let nextSnap = lastSnap;

		for (let i = 0; i < this.snapshotBuffer.length - 1; i += 1) {
			const a = this.snapshotBuffer[i];
			const b = this.snapshotBuffer[i + 1];
			if (a && b && a.receivedAt <= renderTime && renderTime <= b.receivedAt) {
				prevSnap = a;
				nextSnap = b;
				break;
			}
		}

		const span = Math.max(1, nextSnap.receivedAt - prevSnap.receivedAt);
		const t = Math.max(
			0,
			Math.min(1, (renderTime - prevSnap.receivedAt) / span),
		);
		const prevById = new Map(prevSnap.entities.map((e) => [e.id, e]));

		for (const curr of nextSnap.entities) {
			if (curr.kind === "ship" && curr.ownerSlot === this.localOwnerSlot) {
				continue;
			}

			const prev = prevById.get(curr.id) ?? curr;
			const dx = Math.abs(curr.x - prev.x);
			const dy = Math.abs(curr.y - prev.y);

			const x = dx > this.arena.width * 0.5 ? curr.x : lerp(prev.x, curr.x, t);
			const y = dy > this.arena.height * 0.5 ? curr.y : lerp(prev.y, curr.y, t);
			const angle = lerpAngle(prev.angle, curr.angle, t);

			switch (curr.kind) {
				case "ship":
					result.push({
						kind: "ship",
						isLocal: false,
						name:
							this.playerNamesBySlot.get(curr.ownerSlot) ??
							`Pilot #${curr.ownerSlot}`,
						x,
						y,
						angle,
						hp: curr.hp,
						isSpawned: (curr.flags & 1) !== 0,
						shieldTimer: (curr.flags & 2) !== 0 ? 1 : 0,
						rapidFireTimer: (curr.flags & 4) !== 0 ? 1 : 0,
						thrusting: (curr.flags & 8) !== 0,
					});
					break;
				case "bullet":
					result.push({
						kind: "bullet",
						x,
						y,
						angle,
						isMissile: (curr.flags & 1) !== 0,
					});
					break;
				case "asteroid":
					result.push({
						kind: "asteroid",
						x,
						y,
						angle,
						size: (curr.flags & 1) !== 0 ? 2 : 1,
						isSeeker: (curr.flags & 2) !== 0,
					});
					break;
				case "pickup":
					result.push({
						kind: "pickup",
						x,
						y,
						pickupType: (curr.flags & 1) !== 0 ? "shield" : "rapid",
					});
					break;
				default: {
					const _exhaustive: never = curr;
					return _exhaustive;
				}
			}
		}

		return result;
	}

	getSnapshotAgeMs(): number {
		if (this.lastSnapshotReceivedAt === 0) return 0;
		return Math.round(performance.now() - this.lastSnapshotReceivedAt);
	}
}
