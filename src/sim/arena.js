export function createArena(width, height) {
	return { width, height };
}

export function wrapArena(entity, arena) {
	const margin = entity.radius ?? 16;

	if (entity.pos.x < -margin) {
		entity.pos.x = arena.width + margin;
	} else if (entity.pos.x > arena.width + margin) {
		entity.pos.x = -margin;
	}

	if (entity.pos.y < -margin) {
		entity.pos.y = arena.height + margin;
	} else if (entity.pos.y > arena.height + margin) {
		entity.pos.y = -margin;
	}
}
