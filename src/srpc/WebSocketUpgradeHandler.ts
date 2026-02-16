import { IncomingMessage } from 'http';
import WebSocket from 'ws';

const UpgradeClaimedSymbol = Symbol('srpc-upgrade-claimed');
const UpgradeRejectTimerSymbol = Symbol('srpc-upgrade-reject-timer');
const UpgradeOriginalWriteSymbol = Symbol('srpc-upgrade-original-write');
const UpgradeWriteProbeBufferSymbol = Symbol('srpc-upgrade-write-probe-buffer');
const UpgradeClaimHandlingInstalledSymbol = Symbol('srpc-upgrade-claim-handling-installed');
const InstalledUpgradeHandlersSymbol = Symbol('srpc-installed-upgrade-handlers');
const DEFAULT_UNCLAIMED_UPGRADE_REJECTION_DELAY_MS = 1_000;
type UpgradeRejectionTimer = ReturnType<typeof setTimeout>;
type UpgradeHandler = (req: IncomingMessage, socket: import('net').Socket, head: Buffer) => void;

type VerifyClientFn = (
    info: { origin: string; secure: boolean; req: IncomingMessage },
    cb: (res: boolean, code?: number, message?: string) => void
) => void;

type UpgradeClaimHandlingOptions = {
    unclaimedUpgradeRejectionDelayMs?: number;
};

type WebSocketUpgradeHandlerOptions = UpgradeClaimHandlingOptions & {
    httpServer: import('http').Server;
    wsPath: string;
    wsServer: WebSocket.Server;
    verifyClient: VerifyClientFn;
};

function extractProbeChunk(chunk: unknown): string {
    if (typeof chunk === 'string') return chunk;
    if (Buffer.isBuffer(chunk)) return chunk.toString('latin1');
    if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString('latin1');
    return '';
}

function clearUpgradeSuccessProbe(socket: import('net').Socket): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anySocket = socket as any;
    const originalWrite = anySocket[UpgradeOriginalWriteSymbol] as ((...args: unknown[]) => unknown) | undefined;
    if (!originalWrite) return;

    anySocket.write = originalWrite;
    delete anySocket[UpgradeOriginalWriteSymbol];
    delete anySocket[UpgradeWriteProbeBufferSymbol];
}

function installUpgradeSuccessProbe(socket: import('net').Socket): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anySocket = socket as any;
    if (anySocket[UpgradeOriginalWriteSymbol]) return;

    const originalWrite = anySocket.write as (...args: unknown[]) => unknown;
    anySocket[UpgradeOriginalWriteSymbol] = originalWrite;
    anySocket[UpgradeWriteProbeBufferSymbol] = '';

    anySocket.write = function (this: unknown, chunk: unknown, ...args: unknown[]) {
        if (!anySocket[UpgradeClaimedSymbol]) {
            const probeChunk = extractProbeChunk(chunk);
            if (probeChunk) {
                const previous = String(anySocket[UpgradeWriteProbeBufferSymbol] ?? '');
                const probeBuffer = (previous + probeChunk).slice(0, 256);
                anySocket[UpgradeWriteProbeBufferSymbol] = probeBuffer;

                if (/^HTTP\/1\.[01]\s+101\b/i.test(probeBuffer.trimStart())) {
                    markUpgradeClaimed(socket);
                }
            }
        }
        return originalWrite.apply(this, [chunk, ...args]);
    };

    socket.once('close', () => {
        clearUpgradeSuccessProbe(socket);
        clearUpgradeRejectionTimer(socket);
    });
}

function clearUpgradeRejectionTimer(socket: import('net').Socket): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timer = (socket as any)[UpgradeRejectTimerSymbol] as UpgradeRejectionTimer | undefined;
    if (timer) {
        clearTimeout(timer);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (socket as any)[UpgradeRejectTimerSymbol];
    }
}

/**
 * Monkey-patches `httpServer.emit` so that once an upgrade listener claims
 * a socket (by setting UpgradeClaimedSymbol), no further listeners are
 * invoked. This prevents consumer @AutoStart services from destroying
 * sockets that an SrpcServer is already handling.
 *
 * Also installs a low-priority fallback that destroys any socket not
 * claimed by any handler (via delayed timeout).
 */
function installUpgradeClaimHandling(httpServer: import('http').Server, options?: UpgradeClaimHandlingOptions) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyServer = httpServer as any;
    if (anyServer[UpgradeClaimHandlingInstalledSymbol]) return;
    anyServer[UpgradeClaimHandlingInstalledSymbol] = true;
    const unclaimedUpgradeRejectionDelayMs = Math.max(0, options?.unclaimedUpgradeRejectionDelayMs ?? DEFAULT_UNCLAIMED_UPGRADE_REJECTION_DELAY_MS);

    // Patch emit to stop propagation once a socket is claimed.
    const originalEmit = httpServer.emit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    httpServer.emit = function (this: import('http').Server, event: string | symbol, ...args: any[]): boolean {
        if (event !== 'upgrade') {
            return originalEmit.apply(this, [event, ...args]);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const socket = args[1] as any;
        installUpgradeSuccessProbe(socket);
        const listeners = this.rawListeners('upgrade').slice();
        for (const fn of listeners) {
            (fn as (...args: unknown[]) => unknown).apply(this, args);
            if (socket[UpgradeClaimedSymbol]) break;
        }
        return listeners.length > 0;
    };

    // Fallback: destroy sockets not claimed by any handler.
    httpServer.on('upgrade', (_req, socket: import('net').Socket) => {
        clearUpgradeRejectionTimer(socket);
        const timer = setTimeout(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (!(socket as any)[UpgradeClaimedSymbol] && !socket.destroyed) {
                socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                socket.destroy();
            }
            clearUpgradeRejectionTimer(socket);
        }, unclaimedUpgradeRejectionDelayMs);
        timer.unref?.();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (socket as any)[UpgradeRejectTimerSymbol] = timer;
        socket.once('close', () => {
            clearUpgradeSuccessProbe(socket);
            clearUpgradeRejectionTimer(socket);
        });
    });
}

/**
 * Mark a socket as claimed so that `installUpgradeClaimHandling`'s
 * patched emit stops propagating the `'upgrade'` event to subsequent
 * listeners.
 */
function markUpgradeClaimed(socket: import('net').Socket): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket as any)[UpgradeClaimedSymbol] = true;
    clearUpgradeRejectionTimer(socket);
    clearUpgradeSuccessProbe(socket);
}

export function installWebSocketUpgradeHandler(options: WebSocketUpgradeHandlerOptions): UpgradeHandler {
    const { httpServer, wsPath, wsServer, verifyClient, unclaimedUpgradeRejectionDelayMs } = options;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyServer = httpServer as any;
    const installedHandlers =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (anyServer[InstalledUpgradeHandlersSymbol] as Map<string, UpgradeHandler> | undefined) ?? new Map();
    anyServer[InstalledUpgradeHandlersSymbol] = installedHandlers;

    const existingHandler = installedHandlers.get(wsPath);
    if (existingHandler) {
        installUpgradeClaimHandling(httpServer, { unclaimedUpgradeRejectionDelayMs });
        return existingHandler;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upgradeHandler = (req: IncomingMessage, socket: any, head: Buffer) => {
        const pathname = req.url?.split('?')[0];
        if (pathname !== wsPath) return;

        markUpgradeClaimed(socket);

        verifyClient({ origin: '', secure: false, req }, (allowed, code, message) => {
            if (!allowed) {
                socket.write(`HTTP/1.1 ${code ?? 403} ${message ?? 'Forbidden'}\r\n\r\n`);
                socket.destroy();
                return;
            }

            wsServer.handleUpgrade(req, socket, head, ws => {
                wsServer.emit('connection', ws, req);
            });
        });
    };

    httpServer.prependListener('upgrade', upgradeHandler);
    installedHandlers.set(wsPath, upgradeHandler);
    installUpgradeClaimHandling(httpServer, { unclaimedUpgradeRejectionDelayMs });
    return upgradeHandler;
}
