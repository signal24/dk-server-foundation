import { unlink } from 'fs/promises';
import { Readable, Writable } from 'stream';

export class PipeError extends Error {
    constructor(
        public readonly cause: Error,
        public readonly side: 'input' | 'output'
    ) {
        super(cause.message);
    }
}

export function safePipe(input: Readable, output: Writable) {
    return new Promise<void>((resolve, reject) => {
        input.on('close', () => {
            if (!input.readableEnded) {
                if (!output.destroyed) output.destroy();
                reject(new PipeError(new Error('Input stream aborted'), 'input'));
            }
        });
        input.on('error', err => {
            if (!output.destroyed) output.destroy();
            reject(new PipeError(err, 'input'));
        });

        output.on('close', () => {
            if (!output.writableEnded) {
                if (!input.destroyed) input.destroy();
                reject(new PipeError(new Error('Output stream aborted'), 'output'));
            }
        });
        output.on('error', err => {
            if (!input.destroyed) input.destroy();
            reject(new PipeError(err, 'output'));
        });

        output.on('finish', () => {
            resolve();
        });
        input.pipe(output);
    });
}

class ResourceTracker {
    files: string[] = [];
    streams: (Readable | Writable)[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private reject: (err: any) => void) {}

    addStream(stream: Readable | Writable) {
        stream.on('error', this.reject);
        this.streams.push(stream);
    }

    addFile(file: string) {
        this.files.push(file);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withResourceCleanup<T>(fn: (tracker: ResourceTracker) => Promise<T>, onError?: (err: any) => void) {
    return new Promise<T>((resolve, reject) => {
        const tracker = new ResourceTracker(reject);
        fn(tracker)
            .then(resolve, err => {
                onError?.(err);
                reject(err);
            })
            .finally(() => {
                tracker.files.forEach(file => {
                    unlink(file).catch(() => {});
                });
                tracker.streams.forEach(stream => {
                    if (!stream.destroyed) stream.destroy();
                });
            });
    });
}
