export interface InputTracker {
	isDown(code: string): boolean;
	justPressed(code: string): boolean;
	endStep(): void;
}

export function createInput(target: Window = window): InputTracker {
	const down = new Set<string>();
	const pressed = new Set<string>();

	target.addEventListener("keydown", (e: KeyboardEvent) => {
		if (!down.has(e.code)) {
			pressed.add(e.code);
		}
		down.add(e.code);
	});

	target.addEventListener("keyup", (e: KeyboardEvent) => {
		down.delete(e.code);
	});

	target.addEventListener("blur", () => {
		down.clear();
		pressed.clear();
	});

	return {
		isDown: (code) => down.has(code),
		justPressed: (code) => pressed.has(code),
		endStep: () => pressed.clear(),
	};
}
