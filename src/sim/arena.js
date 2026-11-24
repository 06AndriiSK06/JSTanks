export function createArena(width = 960, height = 640) {
	return { width, height };
}

export function wrapArena(entity, arena) {
	let wrapped = false;

	if (entity.x < 0) {
		entity.x += arena.width;
		wrapped = true;
	} else if (entity.x >= arena.width) {
		entity.x -= arena.width;
		wrapped = true;
	}

	if (entity.y < 0) {
		entity.y += arena.height;
		wrapped = true;
	} else if (entity.y >= arena.height) {
		entity.y -= arena.height;
		wrapped = true;
	}

	return wrapped;
}
