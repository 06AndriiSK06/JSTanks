import {
	asSeq,
	normalizeAngle,
	type PlayerInputCommand,
	type SharedWorld,
} from "@jstanks/shared";

export class BotPlayer {
	readonly id: string;
	readonly name: string;
	private seqCounter = 1;
	private strafeDir: -1 | 1 = 1;
	private strafeTimer = 2.0;

	constructor(index: number) {
		this.id = `bot-${index}`;
		this.name = `Bot-${index}`;
	}

	decideInput(world: SharedWorld, dt: number): PlayerInputCommand {
		const seq = asSeq(this.seqCounter++);
		const selfShip = world.ships.get(this.id);
		if (!selfShip?.isSpawned()) {
			return {
				seq,
				thrust: 0,
				turn: 0,
				fire: false,
				missile: false,
				clientTick: world.tick,
			};
		}

		this.strafeTimer -= dt;
		if (this.strafeTimer <= 0) {
			this.strafeTimer = 1.5 + (world.tick % 3);
			this.strafeDir = this.strafeDir === 1 ? -1 : 1;
		}

		let targetX = world.arena.width * 0.5;
		let targetY = world.arena.height * 0.5;
		let bestDist = Number.POSITIVE_INFINITY;
		let targetIsShip = false;

		for (const other of world.ships.values()) {
			if (other.ownerId === this.id || !other.isSpawned()) continue;
			const d = selfShip.pos.distanceTo(other.pos);
			if (d < bestDist) {
				bestDist = d;
				targetX = other.pos.x;
				targetY = other.pos.y;
				targetIsShip = true;
			}
		}

		if (!targetIsShip) {
			for (const ast of world.asteroids.values()) {
				if (!ast.alive) continue;
				const d = selfShip.pos.distanceTo(ast.pos);
				if (d < bestDist) {
					bestDist = d;
					targetX = ast.pos.x;
					targetY = ast.pos.y;
				}
			}
		}

		const desiredAngle = Math.atan2(
			targetY - selfShip.pos.y,
			targetX - selfShip.pos.x,
		);
		const angleDiff = normalizeAngle(desiredAngle - selfShip.angle);

		let turn: -1 | 0 | 1 = 0;
		if (angleDiff > 0.12) turn = 1;
		else if (angleDiff < -0.12) turn = -1;

		const thrust: -1 | 0 | 1 = bestDist > 190 ? 1 : bestDist < 110 ? -1 : 0;
		const aimed = Math.abs(angleDiff) < 0.25 && bestDist < 520;

		return {
			seq,
			thrust,
			turn: turn === 0 && bestDist < 220 ? this.strafeDir : turn,
			fire: aimed,
			missile: aimed && targetIsShip && bestDist > 240,
			clientTick: world.tick,
		};
	}
}
