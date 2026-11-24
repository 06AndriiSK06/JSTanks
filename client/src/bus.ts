export type EventHandler<T> = (payload: T) => void;

export class Bus<E extends Record<string, unknown>> {
	private readonly listeners = new Map<keyof E, Set<EventHandler<unknown>>>();

	on<K extends keyof E>(name: K, fn: EventHandler<E[K]>): () => void {
		let set = this.listeners.get(name);
		if (!set) {
			set = new Set();
			this.listeners.set(name, set);
		}
		const wrapped = fn as EventHandler<unknown>; // приведення обробника для зберігання у спільній Map
		set.add(wrapped);
		return () => {
			set?.delete(wrapped);
		};
	}

	emit<K extends keyof E>(name: K, payload: E[K]): void {
		const set = this.listeners.get(name);
		if (!set) return;
		for (const fn of set) {
			fn(payload);
		}
	}
}
