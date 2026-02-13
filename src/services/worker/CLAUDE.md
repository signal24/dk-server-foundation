# Worker System

The worker system integrates BullMQ to queue background jobs and Deepkit services to run them. Enabling workers wires together the queue registry, runner, observer, CLI commands, and the `_jobs` audit table.

## Enabling Workers

```ts
import { createApp } from '../app';

const app = createApp({
    config: MyConfig,
    enableWorker: true
    // …
});
```

When `enableWorker` is set:

- `WorkerService` becomes injectable for queueing jobs.
- `WorkerRunnerService` and `WorkerObserverService` are registered (but only started when appropriate).
- CLI controllers (`worker:start`, `worker:runner`, `worker:observer`, `worker:queue`) become available.
- `JobEntity` is added to the database schema to persist job lifecycle data.

At runtime, the runner/observer auto-start in non-production environments. In production, toggle them with configuration flags (`ENABLE_JOB_RUNNER`, `ENABLE_JOB_OBSERVER`). They can also be launched explicitly through the CLI commands listed above.

## Defining Jobs

Jobs extend `BaseJob` and are annotated with the `@WorkerJob()` decorator so the runner can discover them:

```ts
import { BaseJob, WorkerJob } from '../services/worker';

@WorkerJob()
class SendEmailJob extends BaseJob<{ to: string; subject: string }, void> {
    constructor(private mailer: MailService) {
        super();
    }

    async handle(data: { to: string; subject: string }) {
        await this.mailer.send(data.to, data.subject);
    }
}
```

Optional static configuration:

- `QUEUE_NAME` – assign the job to a named queue (defaults to the app's `BULL_QUEUE`).
- `CRON_SCHEDULE` – schedule recurring execution using a cron pattern (registered automatically when the runner starts).

The job instance receives dependencies via Deepkit's injector. There is no BullMQ `Job` object injected—log additional context yourself if needed.

## Queueing Jobs

Use `WorkerService.queueJob()` from request handlers or other services:

```ts
class NotificationController {
    constructor(private worker: WorkerService) {}

    async sendWelcome(to: string) {
        await this.worker.queueJob(SendEmailJob, { to, subject: 'Welcome!' });
    }
}
```

`queueJob` accepts an optional `{ delay?: number }` option. When running in test environment (`APP_ENV=test`), the method simply logs a warning and skips queueing to keep tests deterministic.

## Runner & Observer

- **WorkerRunnerService** pulls jobs from the configured BullMQ queue and invokes the `handle()` method. It resolves job classes registered with `@WorkerJob()` and honours `CRON_SCHEDULE`.
- **WorkerObserverService** listens for BullMQ lifecycle events, writes entries to the `_jobs` table via `JobEntity`, and clears completed/failed jobs from Redis after logging. It also wires into the health-check system to ensure Redis remains reachable.

Both services close BullMQ resources during shutdown and support graceful termination through the Deepkit event system.

## Redis & Configuration

All worker components share Redis connection settings derived from `BaseAppConfig` (e.g. `BULL_QUEUE`, `REDIS_HOST` or sentinel configuration). Ensure these values are populated before starting the app or dedicated worker processes.
