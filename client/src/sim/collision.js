export function detectCollisions(world) {
	const collidables = [];
	for (const entity of world) {
		if (!entity.alive || entity.kind === "explosion") continue;
		if (typeof entity.isSpawned === "function" && !entity.isSpawned()) {
			continue;
		}
		collidables.push(entity);
	}

	const pairs = [];
	for (let i = 0; i < collidables.length; i += 1) {
		const a = collidables[i];
		for (let j = i + 1; j < collidables.length; j += 1) {
			const b = collidables[j];
			const maxDist = a.radius + b.radius;
			if (a.pos.distanceTo(b.pos) < maxDist) {
				pairs.push([a, b]);
			}
		}
	}
	return pairs;
}
