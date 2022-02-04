export class HashSet<T, U> {
    private map: Map<U, T> = new Map();
    private hash_fn: (input: T) => U;

    constructor(hash_fn: (input: T) => U) {
        this.hash_fn = hash_fn;
    }

    add(value: T) {
        this.map.set(this.hash_fn(value), value);
    }

    get(value: T): T | undefined {
        return this.map.get(this.hash_fn(value));
    }

    has(value: T): boolean {
        return this.map.has(this.hash_fn(value));
    }

    get size(): number {
        return this.map.size;
    }

    iter(): IterableIterator<T> {
        return this.map.values();
    }
}
