export function toArray<T>(value: T | T[]): T[] {
    return Array.isArray(value) ? value : [value];
}

export async function asyncMap<T, R>(items: T[], callback: (item: T, idx: number) => Promise<R>): Promise<R[]> {
    const result: R[] = [];
    for (let i = 0; i < items.length; i++) {
        result.push(await callback(items[i], i));
    }
    return result;
}
