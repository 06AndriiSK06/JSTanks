export class Vector2 {
	readonly x: number;
	readonly y: number;

	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}

	static fromAngle(angle: number, magnitude = 1): Vector2 {
		return new Vector2(
			Math.cos(angle) * magnitude,
			Math.sin(angle) * magnitude,
		);
	}

	add(v: Vector2): Vector2 {
		return new Vector2(this.x + v.x, this.y + v.y);
	}

	sub(v: Vector2): Vector2 {
		return new Vector2(this.x - v.x, this.y - v.y);
	}

	scale(scalar: number): Vector2 {
		return new Vector2(this.x * scalar, this.y * scalar);
	}

	length(): number {
		return Math.hypot(this.x, this.y);
	}

	normalize(): Vector2 {
		const len = this.length();
		if (len === 0) return new Vector2(0, 0);
		return new Vector2(this.x / len, this.y / len);
	}

	distanceTo(v: Vector2): number {
		return Math.hypot(this.x - v.x, this.y - v.y);
	}

	clone(): Vector2 {
		return new Vector2(this.x, this.y);
	}
}
