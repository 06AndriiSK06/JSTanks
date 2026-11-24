import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";

export class Pickup extends Entity {
	constructor({ pos, pickupType = "shield", ttl = 14 }) {
		super({
			pos,
			vel: new Vector2(0, 0),
			angle: 0,
			radius: 15,
			kind: "pickup",
		});
		this.pickupType = pickupType; // "shield" | "rapid"
		this.ttl = ttl;
		this.pulse = 0;
	}

	update(dt, world) {
		this.pulse += dt * 4;
		this.ttl -= dt;
		if (this.ttl <= 0) {
			world.despawn(this.id);
		}
	}
}
