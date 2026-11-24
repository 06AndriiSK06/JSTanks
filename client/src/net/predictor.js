import { SimShip, Vector2 } from "@jstanks/shared";

const SERVER_DT = 1 / 30;

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
	let diff = b - a;
	while (diff > Math.PI) diff -= Math.PI * 2;
	while (diff < -Math.PI) diff += Math.PI * 2;
	return a + diff * t;
}

export class NetworkSession {
	constructor({ arenaWidth = 1200, arenaHeight = 760 } = {}) {
		this.arena = { width: arenaWidth, height: arenaHeight };
		this.localPlayerId = null;
		this.localOwnerSlot = 0;
		this.playerNamesBySlot = new Map();

		this.predictionEnabled = true;
		this.breakDeterminism = false;
		this.interpolationDelayMs = 75;

		this.localShip = null;
		this.visualOffset = new Vector2(0, 0);
		this.pendingInputs = [];
		this.nextSeq = 1;
		this.lastAckSeq = 0;
		this.lastCorrectionPx = 0;

		this.localBullets = [];
		this.snapshotBuffer = [];
		this.lastSnapshotReceivedAt = 0;
		this.serverTick = 0;
	}

	setIdentity({ playerId, ownerSlot, roster = [], arena }) {
		this.localPlayerId = playerId;
		this.localOwnerSlot = ownerSlot;
		if (arena) {
			this.arena = { width: arena.width ?? 1200, height: arena.height ?? 760 };
		}
		this.updateRoster(roster);
	}

	updateRoster(roster = []) {
		this.playerNamesBySlot.clear();
		for (const p of roster) {
			if (p.ownerSlot !== undefined) {
				this.playerNamesBySlot.set(p.ownerSlot, p.name);
			}
		}
	}

	stepLocalPrediction(dt, rawControls) {
		for (const b of this.localBullets) {
			b.ttl -= dt;
			b.x = (b.x + b.vx * dt + this.arena.width) % this.arena.width;
			b.y = (b.y + b.vy * dt + this.arena.height) % this.arena.height;
		}
		this.localBullets = this.localBullets.filter((b) => b.ttl > 0);

		const decay = Math.exp(-dt / 0.08);
		this.visualOffset = this.visualOffset.scale(decay);

		const seq = this.nextSeq++;
		const input = {
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
				this.localShip.pos.x += (Math.random() - 0.5) * 18;
				this.localShip.pos.y += (Math.random() - 0.5) * 18;
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

	onSnapshot(snapshot) {
		const now = performance.now();
		this.lastSnapshotReceivedAt = now;
		this.serverTick = snapshot.tick;
		this.lastAckSeq = snapshot.lastProcessedSeq ?? 0;

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
			(e) => e.kind === "ship" && e.ownerSlot === this.localOwnerSlot,
		);
		if (!authShip) return;

		if (!this.localShip) {
			this.localShip = new SimShip({
				id: authShip.id,
				ownerId: this.localPlayerId,
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

	getRenderEntities() {
		const result = [];
		const now = performance.now();

		if (this.localShip) {
			result.push({
				id: this.localShip.id,
				kind: "ship",
				isLocal: true,
				name: this.localShip.name,
				x: this.localShip.pos.x + this.visualOffset.x,
				y: this.localShip.pos.y + this.visualOffset.y,
				angle: this.localShip.angle,
				hp: this.localShip.hp,
				score: this.localShip.score,
				isSpawned: this.localShip.isSpawned(),
				shieldTimer: this.localShip.shieldTimer,
				rapidFireTimer: this.localShip.rapidFireTimer,
				thrusting: this.localShip.thrusting,
			});
		}

		for (const lb of this.localBullets) {
			result.push({
				id: `local-${lb.seq}`,
				kind: "bullet",
				x: lb.x,
				y: lb.y,
				angle: lb.angle,
				isMissile: lb.isMissile,
			});
		}

		if (this.snapshotBuffer.length === 0) {
			return result;
		}

		const renderTime = now - this.interpolationDelayMs;
		let prevSnap = this.snapshotBuffer[0];
		let nextSnap = this.snapshotBuffer[this.snapshotBuffer.length - 1];

		for (let i = 0; i < this.snapshotBuffer.length - 1; i += 1) {
			const a = this.snapshotBuffer[i];
			const b = this.snapshotBuffer[i + 1];
			if (a.receivedAt <= renderTime && renderTime <= b.receivedAt) {
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

			result.push({
				id: curr.id,
				kind: curr.kind,
				isLocal: false,
				name:
					this.playerNamesBySlot.get(curr.ownerSlot) ??
					`Pilot #${curr.ownerSlot}`,
				x,
				y,
				angle,
				hp: curr.hp,
				score: curr.score,
				flags: curr.flags,
				isSpawned: curr.kind === "ship" ? (curr.flags & 1) !== 0 : true,
				shieldTimer: curr.kind === "ship" && (curr.flags & 2) !== 0 ? 1 : 0,
				rapidFireTimer: curr.kind === "ship" && (curr.flags & 4) !== 0 ? 1 : 0,
				thrusting: curr.kind === "ship" && (curr.flags & 8) !== 0,
				isMissile: curr.kind === "bullet" && (curr.flags & 1) !== 0,
				size: curr.kind === "asteroid" && (curr.flags & 1) !== 0 ? 2 : 1,
				isSeeker: curr.kind === "asteroid" && (curr.flags & 2) !== 0,
				pickupType:
					curr.kind === "pickup" && (curr.flags & 1) !== 0 ? "shield" : "rapid",
			});
		}

		return result;
	}

	getSnapshotAgeMs() {
		if (this.lastSnapshotReceivedAt === 0) return 0;
		return Math.round(performance.now() - this.lastSnapshotReceivedAt);
	}
}
