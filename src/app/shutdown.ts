import { EventDispatcher, EventToken, eventDispatcher } from '@deepkit/event';
import { onServerBootstrapDone } from '@deepkit/framework';
import { Logger } from '@deepkit/logger';

export const onServerShutdownRequested = new EventToken('server.shutdown-requested');

export class ShutdownListener {
    private shutdownPromise: Promise<void> | undefined;

    constructor(
        private eventDispatcher: EventDispatcher,
        private logger: Logger
    ) {}

    @eventDispatcher.listen(onServerBootstrapDone)
    reconfigureShutdown(): void {
        const sigtermListeners = process.listeners('SIGTERM');
        const sigintListeners = process.listeners('SIGINT');
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGINT');

        process.on('SIGTERM', signal => {
            this.handleShutdown()
                .then(() => {
                    for (const listener of sigtermListeners) {
                        listener(signal);
                    }
                })
                .catch(err => {
                    this.logger.error('Error during shutdown', err as Error);
                    process.exit(1);
                });
        });

        process.on('SIGINT', signal => {
            this.handleShutdown()
                .then(() => {
                    for (const listener of sigintListeners) {
                        listener(signal);
                    }
                })
                .catch(err => {
                    this.logger.error('Error during shutdown', err as Error);
                    process.exit(1);
                });
        });
    }

    async handleShutdown(): Promise<void> {
        if (!this.shutdownPromise) {
            this.shutdownPromise = this.eventDispatcher.dispatch(onServerShutdownRequested);
        }
        return this.shutdownPromise;
    }
}
