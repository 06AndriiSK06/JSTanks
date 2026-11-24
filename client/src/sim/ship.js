import { wrapArena } from "./arena.js";
import { createShell } from "./bullet.js";
import { createHoming } from "./components.js";
import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";

export class Ship extends Entity {
	#hp = 100;
	#maxHp = 100;

	constructor(x, y) {
		super({
			pos: new Vector2(x, y),
			vel: new Vector2(0, 0),
			angle: -Math.PI / 2,
			radius: 19,
			kind: "ship",
		});

		this.turnSpeed = 3.1;
		this.forwardAccel = 540;
		this.reverseAccel = 320;
		this.drag = 2.4;
		this.maxSpeed = 340;
		this.thrusting = false;

		this.fireCooldown = 0;
		this.missileCooldown = 0;
		this.rapidFireTimer = 0;
		this.shieldTimer = 0;
		this.respawnTimer = 0;
	}

	get hp() {
		return this.#hp;
	}

	get maxHp() {
		return this.#maxHp;
	}

	isSpawned() {
		return this.respawnTimer <= 0;
	}

	takeDamage(amount) {
		if (!this.isSpawned()) return false;
		if (this.shieldTimer > 0) {
			return false;
		}
		this.#hp = Math.max(0, this.#hp - amount);
		if (this.#hp === 0) {
			this.respawnTimer = 2.0;
			this.vel = new Vector2(0, 0);
			this.thrusting = false;
			return true;
		}
		return false;
	}

	heal(amount) {
		this.#hp = Math.min(this.#maxHp, this.#hp + amount);
	}

	applyPickup(type) {
		if (type === "shield") {
			this.heal(40);
			this.shieldTimer = 6.0;
		} else if (type === "rapid") {
			this.rapidFireTimer = 7.0;
		}
	}

	respawn(pos) {
		this.pos = pos.clone();
		this.prevPos = pos.clone();
		this.vel = new Vector2(0, 0);
		this.angle = -Math.PI / 2;
		this.prevAngle = this.angle;
		this.#hp = this.#maxHp;
		this.respawnTimer = 0;
		this.shieldTimer = 2.5;
	}

	fire({ isMissile = false } = {}) {
		if (!this.isSpawned()) return null;

		if (isMissile) {
			if (this.missileCooldown > 0) return null;
			this.missileCooldown = this.rapidFireTimer > 0 ? 0.65 : 1.5;
		} else {
			if (this.fireCooldown > 0) return null;
			this.fireCooldown = this.rapidFireTimer > 0 ? 0.14 : 0.3;
		}

		const barrelOffset = Vector2.fromAngle(this.angle, this.radius + 10);
		const muzzlePos = this.pos.add(barrelOffset);
		const homing = isMissile
			? createHoming({
					targetKind: "asteroid",
					turnRate: 5.5,
					range: 650,
					maxSpeed: 540,
				})
			: null;

		return createShell({
			pos: muzzlePos,
			angle: this.angle,
			baseVel: this.vel,
			ownerId: this.id,
			isMissile,
			homing,
		});
	}

	update(dt, world) {
		if (this.fireCooldown > 0)
			this.fireCooldown = Math.max(0, this.fireCooldown - dt);
		if (this.missileCooldown > 0)
			this.missileCooldown = Math.max(0, this.missileCooldown - dt);
		if (this.rapidFireTimer > 0)
			this.rapidFireTimer = Math.max(0, this.rapidFireTimer - dt);
		if (this.shieldTimer > 0)
			this.shieldTimer = Math.max(0, this.shieldTimer - dt);

		if (this.respawnTimer > 0) {
			this.respawnTimer -= dt;
			if (this.respawnTimer <= 0) {
				const safePos = world.findSafeSpawnPos();
				this.respawn(safePos);
			}
			return;
		}

		const input = world.input;
		if (!input) return;

		const turnLeft = input.isDown("KeyA") || input.isDown("ArrowLeft");
		const turnRight = input.isDown("KeyD") || input.isDown("ArrowRight");
		const forward = input.isDown("KeyW") || input.isDown("ArrowUp");
		const backward = input.isDown("KeyS") || input.isDown("ArrowDown");

		const turnDir = (turnRight ? 1 : 0) - (turnLeft ? 1 : 0);
		this.angle += turnDir * this.turnSpeed * dt;

		let accel = 0;
		if (forward) accel += this.forwardAccel;
		if (backward) accel -= this.reverseAccel;

		this.thrusting = forward || backward;

		if (accel !== 0) {
			const forwardVec = Vector2.fromAngle(this.angle, accel * dt);
			this.vel = this.vel.add(forwardVec);
		}

		const damping = Math.exp(-this.drag * dt);
		this.vel = this.vel.scale(damping);

		const speed = this.vel.length();
		if (speed > this.maxSpeed) {
			this.vel = this.vel.scale(this.maxSpeed / speed);
		}

		this.pos = this.pos.add(this.vel.scale(dt));
		wrapArena(this, world.arena);

		if (input.isDown("Space") || input.isDown("KeyF")) {
			const shell = this.fire({ isMissile: false });
			if (shell) world.spawn(shell);
		}

		if (input.justPressed("KeyE") || input.justPressed("ShiftLeft")) {
			const missile = this.fire({ isMissile: true });
			if (missile) world.spawn(missile);
		}
	}
}
