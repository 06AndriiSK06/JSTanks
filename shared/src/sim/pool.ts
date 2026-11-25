export class ObjectPool<T> {
	private readonly free: T[] = [];
	private readonly factory: () => T;
	private readonly resetFn: (item: T) => void;
	totalCreated = 0;

	constructor(
		factory: () => T,
		resetFn: (item: T) => void,
		initialCapacity = 32,
	) {
		this.factory = factory;
		this.resetFn = resetFn;
		for (let i = 0; i < initialCapacity; i += 1) {
			this.free.push(this.factory());
			this.totalCreated += 1;
		}
	}

	acquire(): T {
		const recycled = this.free.pop();
		if (recycled !== undefined) {
			this.resetFn(recycled);
			return recycled;
		}
		this.totalCreated += 1;
		return this.factory();
	}

	release(item: T): void {
		this.free.push(item);
	}

	get availableCount(): number {
		return this.free.length;
	}
}
