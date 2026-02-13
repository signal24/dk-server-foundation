import { EventDispatcher } from '@deepkit/event';
import { ApplicationServer, onServerMainBootstrapDone, onServerShutdown } from '@deepkit/framework';
import { HttpRouterRegistry } from '@deepkit/http';

import { r } from '../app/resolver';
import { globalState } from '../app/state';
import { HealthcheckController } from '../health/healthcheck.controller';
import { MetricsController } from '../telemetry/otel/metrics.controller';

export abstract class CliServiceCommand {
    private eventDispatcher = r(EventDispatcher);
    private appServer = r(ApplicationServer);
    private routerRegistry = r(HttpRouterRegistry);
    protected shouldRun = true;
    public stop: () => void = () => {};

    async execute() {
        // note that we're a CLI service to prevent non-CLI side effects
        globalState.isCliService = true;

        // disable workers
        this.appServer.config.workers = 0;

        // remove all controllers except health-related ones
        const routes = this.routerRegistry.getRoutes();
        for (let i = 0; i < routes.length; i++) {
            const route = routes[i];
            if (route.action.type === 'controller') {
                if (route.action.controller === HealthcheckController || route.action.controller === MetricsController) {
                    continue;
                }
            }
            routes.splice(i, 1);
            i--;
        }

        // start the application server. tell it to wait for signals, but don't want for it to return,
        // as when listening to stop signals, it won't return until the server shuts down. instead, we
        // can listen to the onServerMainBootstrapDone event to actually wait for the server to start
        const onServerMainBootstrapDonePromise = new Promise<void>(resolve => {
            this.eventDispatcher.listen(onServerMainBootstrapDone, () => resolve());
        });
        this.appServer.start(true);
        await onServerMainBootstrapDonePromise;

        // prepare stop
        const hasRunService = this.runService !== CliServiceCommand.prototype.runService;
        const stopPromise = new Promise<void>(resolve => {
            const handleStop = () => {
                this.shouldRun = false;
                resolve();
            };
            this.eventDispatcher.listen(onServerShutdown, handleStop);
            this.stop = handleStop;
        });

        // start our CLI service
        await this.startService();

        // wait for stop signal
        if (hasRunService) {
            await this.runService();
        } else {
            await stopPromise;
        }

        // process shutdown
        await this.shutdownService();
    }

    protected async startService(): Promise<void> {}
    protected async runService(): Promise<void> {}
    protected async shutdownService(): Promise<void> {}
}
