import debug from 'debug';
import { memoize } from 'lodash';
import { Duplex } from 'stream';

import { createLogger } from '../services/logger';

////////////////////////////////////////
// Types

const ByteStreamInfo = Symbol('ByteStreamInfo');

interface IByteStreamInfo {
    receivers: Map<number, SrpcByteStream>;
    senders: Map<number, SrpcByteStream>;
    nextId: number;
    step: number;
    pendingReceivers?: Map<number, IPendingReceiver>;
}

interface IPendingReceiver {
    chunks: Buffer[];
    bytes: number;
    finished: boolean;
    destroyedError?: Error;
    timeout?: NodeJS.Timeout;
}

export interface IByteStream {
    [ByteStreamInfo]?: IByteStreamInfo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    write(streamId: number, data: any): boolean;
    finish(streamId: number): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    destroy(streamId: number, err?: any): void;
    attachDisconnectHandler(handler: () => void): void;
    detachDisconnectHandler(handler: () => void): void;
    getBufferedAmount(): number;
    parentStreamId: string;
}

export interface IByteStreamable {
    byteStream: IByteStream;
}

////////////////////////////////////////
// Configuration

/** High water mark - pause writing when WebSocket buffer exceeds this (256KB) */
const HIGH_WATER_MARK = 256 * 1024;
/** Max bytes to buffer for a receiver that hasn't been created yet (2MB) */
const PENDING_RECEIVER_MAX_BYTES = 2 * 1024 * 1024;
/** How long we'll buffer before failing the pending receiver (5s) */
const PENDING_RECEIVER_TTL_MS = 5000;

////////////////////////////////////////
// Logging

const enableLogger = debug('SrpcByteStream').enabled;
const getLogger = memoize(() => createLogger('SrpcByteStream'));

function log(isSender: boolean, streamId: string, substreamId: number, message: string) {
    if (enableLogger) getLogger().debug(message, { streamId, isSender, substreamId });
}

////////////////////////////////////////
// SrpcByteStream

export class SrpcByteStream extends Duplex {
    private _id: number;
    private stream: IByteStreamable | null;
    private parentStreamId: string;
    private isSender = false;
    private isLocallyDestroyed = false;
    private isRemotelyDestroyed = false;

    // Backpressure state (sender side)
    private drainCallbacks: Array<() => void> = [];
    private waitingForDrain = false;

    get id(): number {
        return this._id;
    }

    constructor(stream: IByteStreamable, id: number = 0) {
        super();

        if (!stream.byteStream[ByteStreamInfo]) {
            stream.byteStream[ByteStreamInfo] = {
                receivers: new Map(),
                senders: new Map(),
                nextId: 1,
                step: 1
            };
        }

        this.stream = stream;
        this.parentStreamId = stream.byteStream.parentStreamId;

        stream.byteStream.attachDisconnectHandler(this.handleDisconnect);

        if (id === 0) {
            const info = stream.byteStream[ByteStreamInfo];
            this._id = info.nextId;
            info.nextId += info.step;

            this.isSender = true;
            info.senders.set(this._id, this);
        } else {
            this._id = id;
            stream.byteStream[ByteStreamInfo].receivers.set(id, this);
            this.on('end', () => this.cleanup());
        }
    }

    ////////////////////////////////////////
    // Static Factory Methods

    static init(stream: IByteStreamable, options: { startId: number; step: number }) {
        if (!stream.byteStream[ByteStreamInfo]) {
            stream.byteStream[ByteStreamInfo] = {
                receivers: new Map(),
                senders: new Map(),
                nextId: options.startId,
                step: options.step
            };
        }
    }

    static createReceiver(stream: IByteStreamable, id: number) {
        if (typeof id !== 'number') {
            throw new Error('Missing stream ID');
        }
        if (stream.byteStream[ByteStreamInfo]?.receivers?.has(id)) {
            throw new Error(`Stream ${id} already exists`);
        }

        log(false, stream.byteStream.parentStreamId, id, 'Created readable stream');
        const receiver = new SrpcByteStream(stream, id);

        const pending = stream.byteStream[ByteStreamInfo]?.pendingReceivers?.get(id);
        if (pending) {
            stream.byteStream[ByteStreamInfo]?.pendingReceivers?.delete(id);
            if (pending.timeout) clearTimeout(pending.timeout);

            if (pending.destroyedError) {
                receiver.destroy(pending.destroyedError);
                return receiver;
            }

            for (const chunk of pending.chunks) {
                receiver.push(chunk);
            }
            if (pending.finished) {
                receiver.push(null);
            }
        }

        return receiver;
    }

    static createSender(stream: IByteStreamable) {
        const sender = new SrpcByteStream(stream);
        log(true, stream.byteStream.parentStreamId, sender.id, 'Created writable stream');
        return sender;
    }

    ////////////////////////////////////////
    // Static Substream Operations

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static writeReceiver(stream: IByteStreamable, id: number, data: any) {
        const substream = stream.byteStream[ByteStreamInfo]?.receivers?.get(id);
        if (!substream) {
            // Receiver may not be created yet; buffer to avoid race with response/byte stream ordering
            const info = stream.byteStream[ByteStreamInfo];
            if (info) {
                if (!info.pendingReceivers) info.pendingReceivers = new Map();
                const pending = info.pendingReceivers.get(id) ?? { chunks: [], bytes: 0, finished: false };
                if (pending.destroyedError) return;

                if (!pending.timeout) {
                    pending.timeout = setTimeout(() => {
                        pending.destroyedError = new Error('Pending receiver expired before creation');
                        pending.chunks = [];
                        pending.bytes = 0;
                        log(false, stream.byteStream.parentStreamId, id, 'Pending receiver expired before creation');
                    }, PENDING_RECEIVER_TTL_MS);
                }

                const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
                pending.bytes += chunk.length;
                if (pending.bytes > PENDING_RECEIVER_MAX_BYTES) {
                    pending.destroyedError = new Error('Pending receiver exceeded max buffered bytes');
                    pending.chunks = [];
                    pending.bytes = 0;
                    log(false, stream.byteStream.parentStreamId, id, 'Pending receiver exceeded max buffered bytes');
                    info.pendingReceivers.set(id, pending);
                    return;
                }

                pending.chunks.push(chunk);
                info.pendingReceivers.set(id, pending);
                log(false, stream.byteStream.parentStreamId, id, 'Buffered write for non-existent receiver');
                return;
            }
            // Receiver may have been destroyed; ignore late writes
            log(false, stream.byteStream.parentStreamId, id, 'Ignoring write to non-existent receiver (already cleaned up)');
            return;
        }
        substream.push(data);
    }

    static finishReceiver(stream: IByteStreamable, id: number) {
        log(false, stream.byteStream.parentStreamId, id, 'Received byte substream finished signal');

        const substream = stream.byteStream[ByteStreamInfo]?.receivers?.get(id);
        if (!substream) {
            const info = stream.byteStream[ByteStreamInfo];
            if (info) {
                if (!info.pendingReceivers) info.pendingReceivers = new Map();
                const pending = info.pendingReceivers.get(id) ?? { chunks: [], bytes: 0, finished: false };
                if (pending.destroyedError) return;
                pending.finished = true;
                info.pendingReceivers.set(id, pending);
                log(false, stream.byteStream.parentStreamId, id, 'Buffered finish for non-existent receiver');
                return;
            }
            // Receiver may have been destroyed; ignore late finish
            log(false, stream.byteStream.parentStreamId, id, 'Ignoring finish for non-existent receiver (already cleaned up)');
            return;
        }
        substream.push(null);
    }

    /**
     * Handle a destroy signal from the remote side.
     * Checks both receivers and senders maps to support bidirectional abort:
     * - If found in receivers: remote sender is aborting, destroy local receiver
     * - If found in senders: remote receiver is aborting, destroy local sender
     */
    static destroySubstream(stream: IByteStreamable, id: number, err?: string) {
        log(false, stream.byteStream.parentStreamId, id, 'Received byte substream destroyed signal');

        const info = stream.byteStream[ByteStreamInfo];

        // Check receivers first (sender → receiver destroy)
        const receiver = info?.receivers?.get(id);
        if (receiver) {
            receiver.isRemotelyDestroyed = true;
            receiver.destroy(err ? new Error(err) : undefined);
            return;
        }

        // Check senders (receiver → sender abort)
        const sender = info?.senders?.get(id);
        if (sender) {
            sender.isRemotelyDestroyed = true;
            sender.destroy(err ? new Error(err) : undefined);
            return;
        }

        // Stream not found - may have already been cleaned up, ignore
        if (info) {
            if (!info.pendingReceivers) info.pendingReceivers = new Map();
            const pending = info.pendingReceivers.get(id) ?? { chunks: [], bytes: 0, finished: false };
            pending.destroyedError = err ? new Error(err) : new Error('Remote destroyed substream');
            pending.chunks = [];
            pending.bytes = 0;
            info.pendingReceivers.set(id, pending);
            log(false, stream.byteStream.parentStreamId, id, 'Buffered destroy for non-existent receiver');
            return;
        }
        log(false, stream.byteStream.parentStreamId, id, 'Ignoring destroy for non-existent substream (already cleaned up)');
    }

    ////////////////////////////////////////
    // Lifecycle

    private handleDisconnect = () => {
        log(this.isSender, this.parentStreamId, this._id, 'Stream terminated during byte substream');
        this.destroy();
    };

    private cleanup() {
        log(this.isSender, this.parentStreamId, this._id, 'Cleaning up byte substream');

        const info = this.stream?.byteStream[ByteStreamInfo];
        if (info) {
            if (this.isSender) {
                info.senders.delete(this._id);
            } else {
                info.receivers.delete(this._id);
            }
        }

        // Reject any pending drain callbacks
        for (const cb of this.drainCallbacks) {
            // Don't call with error - just let them know drain happened (stream is closing)
            cb();
        }
        this.drainCallbacks = [];

        this.stream?.byteStream.detachDisconnectHandler(this.handleDisconnect);
        this.stream = null;
    }

    ////////////////////////////////////////
    // Backpressure - Sender Side

    private pollForDrain() {
        if (!this.waitingForDrain || !this.stream) return;

        const buffered = this.stream.byteStream.getBufferedAmount();
        if (buffered < HIGH_WATER_MARK) {
            log(this.isSender, this.parentStreamId, this._id, `Drain: buffer at ${buffered}, resuming writes`);
            this.waitingForDrain = false;

            // Call all pending callbacks
            const callbacks = this.drainCallbacks;
            this.drainCallbacks = [];
            for (const cb of callbacks) {
                cb();
            }
        } else {
            // Check again after a short delay
            setTimeout(() => this.pollForDrain(), 10);
        }
    }

    ////////////////////////////////////////
    // Duplex Stream Implementation

    _read(_size: number): void {
        // Data is pushed as it becomes available from the remote side.
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        if (!this.stream) {
            callback(new Error('Stream closed'));
            return;
        }

        if (encoding) chunk = Buffer.from(chunk, encoding);

        // Write the data
        this.stream.byteStream.write(this._id, chunk);

        // Check if WebSocket buffer is backing up
        const buffered = this.stream.byteStream.getBufferedAmount();
        if (buffered >= HIGH_WATER_MARK) {
            log(this.isSender, this.parentStreamId, this._id, `Buffer high (${buffered}), waiting for drain`);
            this.waitingForDrain = true;
            this.drainCallbacks.push(callback);

            // Poll for drain completion since WebSocket drain events may not fire reliably
            this.pollForDrain();
        } else {
            callback();
        }
    }

    _final(callback: (error?: Error | null) => void): void {
        log(this.isSender, this.parentStreamId, this._id, 'Byte substream finished');
        this.stream?.byteStream.finish(this._id);
        this.cleanup();
        callback();
    }

    _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        if (!this.isLocallyDestroyed) {
            const errSuffix = error ? ` (err: ${String(error)})` : '';
            log(this.isSender, this.parentStreamId, this._id, `Byte substream destroyed${errSuffix}`);
            if (!this.isRemotelyDestroyed) {
                this.stream?.byteStream.destroy(this._id, error);
            }
            this.isLocallyDestroyed = true;
            this.cleanup();
        }
        super._destroy(error, callback);
    }
}
