import { Vector2 } from "./vector.js";

export class Entity {
	static #nextId = 1;
	#id = Entity.#nextId++;

	constructor({
		pos = new Vector2(0, 0),
		vel = new Vector2(0, 0),
		angle = 0,
		radius = 12,
		kind = "entity",
	} = {}) {
		this.pos = pos.clone();
		this.prevPos = pos.clone();
		this.vel = vel.clone();
		this.angle = angle;
		this.prevAngle = angle;
		this.radius = radius;
		this.kind = kind;
		this.alive = true;
	}

	get id() {
		return this.#id;
	}

	savePreviousState() {
		this.prevPos = this.pos.clone();
		this.prevAngle = this.angle;
	}

	update(dt, _world) {
		this.pos = this.pos.add(this.vel.scale(dt));
	}
}
