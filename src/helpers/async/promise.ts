export function createSemaphore() {
    let isReleased = false;
    let _resolve: () => void;
    const promise = new Promise<void>(resolve => {
        _resolve = resolve;
    });
    return {
        release: () => {
            if (!_resolve) throw new Error('Semaphore not ready');
            if (isReleased) throw new Error('Semaphore already released');
            isReleased = true;
            process.nextTick(_resolve);
        },
        promise
    };
}
