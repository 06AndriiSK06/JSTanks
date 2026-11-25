export interface SpatialBody {
	readonly id: number;
	readonly pos: { readonly x: number; readonly y: number };
	readonly radius: number;
}

export class SpatialHashGrid<T extends SpatialBody> {
	readonly cellSize: number;
	private readonly cells = new Map<number, T[]>();

	constructor(cellSize = 96) {
		this.cellSize = cellSize;
	}

	clear(): void {
		for (const bucket of this.cells.values()) {
			bucket.length = 0;
		}
	}

	private key(cx: number, cy: number): number {
		return ((cx & 0xffff) << 16) | (cy & 0xffff);
	}

	insert(item: T): void {
		const minCx = Math.floor((item.pos.x - item.radius) / this.cellSize);
		const maxCx = Math.floor((item.pos.x + item.radius) / this.cellSize);
		const minCy = Math.floor((item.pos.y - item.radius) / this.cellSize);
		const maxCy = Math.floor((item.pos.y + item.radius) / this.cellSize);

		for (let cx = minCx; cx <= maxCx; cx += 1) {
			for (let cy = minCy; cy <= maxCy; cy += 1) {
				const k = this.key(cx, cy);
				let bucket = this.cells.get(k);
				if (!bucket) {
					bucket = [];
					this.cells.set(k, bucket);
				}
				bucket.push(item);
			}
		}
	}

	queryNear(x: number, y: number, radius: number, out: T[] = []): T[] {
		out.length = 0;
		const minCx = Math.floor((x - radius) / this.cellSize);
		const maxCx = Math.floor((x + radius) / this.cellSize);
		const minCy = Math.floor((y - radius) / this.cellSize);
		const maxCy = Math.floor((y + radius) / this.cellSize);

		for (let cx = minCx; cx <= maxCx; cx += 1) {
			for (let cy = minCy; cy <= maxCy; cy += 1) {
				const bucket = this.cells.get(this.key(cx, cy));
				if (!bucket) continue;
				for (let i = 0; i < bucket.length; i += 1) {
					const candidate = bucket[i];
					if (candidate && !out.includes(candidate)) {
						out.push(candidate);
					}
				}
			}
		}
		return out;
	}
}
