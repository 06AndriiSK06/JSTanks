export function createInput(target = window) {
	const down = new Set();
	const pressed = new Set();

	function onKeyDown(event) {
		if (
			["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
				event.code,
			)
		) {
			event.preventDefault();
		}
		if (!event.repeat && !down.has(event.code)) {
			pressed.add(event.code);
		}
		down.add(event.code);
	}

	function onKeyUp(event) {
		down.delete(event.code);
	}

	function onBlur() {
		down.clear();
		pressed.clear();
	}

	target.addEventListener("keydown", onKeyDown);
	target.addEventListener("keyup", onKeyUp);
	target.addEventListener("blur", onBlur);

	return {
		isDown(code) {
			return down.has(code);
		},
		justPressed(code) {
			return pressed.has(code);
		},
		endStep() {
			pressed.clear();
		},
		destroy() {
			target.removeEventListener("keydown", onKeyDown);
			target.removeEventListener("keyup", onKeyUp);
			target.removeEventListener("blur", onBlur);
		},
	};
}
