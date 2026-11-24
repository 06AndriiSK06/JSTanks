import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";

export class Explosion extends Entity {
	constructor({ pos, color = "#f97316", count = 18, scale = 1 }) {
		super({
			pos,
			vel: new Vector2(0, 0),
			radius: 1,
			kind: "explosion",
		});
		this.ttl = 0.55;
		this.maxTtl = 0.55;
		this.particles = Array.from({ length: count }, () => {
			const a = Math.random() * Math.PI * 2;
			const spd = (50 + Math.random() * 190) * scale;
			return {
				offset: new Vector2(0, 0),
				vel: Vector2.fromAngle(a, spd),
				size: (2 + Math.random() * 3.5) * scale,
				color: Math.random() > 0.35 ? color : "#fde047",
			};
		});
	}

	update(dt, world) {
		this.ttl -= dt;
		if (this.ttl <= 0) {
			world.despawn(this.id);
			return;
		}

		for (const p of this.particles) {
			p.offset = p.offset.add(p.vel.scale(dt));
			p.vel = p.vel.scale(Math.exp(-4.5 * dt));
		}
	}
}
