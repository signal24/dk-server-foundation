# Worker System

The worker system integrates BullMQ to queue background jobs and Deepkit services to run them. Enabling workers wires together the queue registry, runner, recorder, CLI commands, and the `_jobs` audit table.

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
- `WorkerRunnerService` is registered (but only started when appropriate).
- CLI controllers (`worker:start`, `worker:queue`) become available.
- `JobEntity` is added to the database schema to persist job lifecycle data.

At runtime, the runner auto-starts in non-production environments. In production, toggle it with the `ENABLE_JOB_RUNNER` configuration flag. It can also be launched explicitly through the `worker:start` CLI command.

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

## Runner & Recorder

- **WorkerRunnerService** pulls jobs from the configured BullMQ queue and invokes the `handle()` method. It resolves job classes registered with `@WorkerJob()` and honours `CRON_SCHEDULE`.
- **WorkerRecorderService** listens for BullMQ lifecycle events, writes entries to the `_jobs` table via `JobEntity`, and clears completed/failed jobs from Redis after logging. It is instantiated by the runner, not via DI.

### Leader Election

The runner uses `LeaderService` (Redis-based leader election) so that when multiple runners are deployed, only one acts as the recorder at any given time. The recorder lifecycle is:

1. Runner starts and calls `recorder.ensureTableExists()` to ensure the `_jobs` table exists.
2. Runner creates a `LeaderService('worker-recorder')` and starts election.
3. When a runner becomes leader, it calls `recorder.start()` to begin listening for queue events.
4. When leadership is lost, it calls `recorder.stop()` to close the QueueEvents connection.
5. On shutdown, the runner explicitly stops both the leader service and the recorder.

This eliminates the need for a separate observer process — just run runners, and one automatically handles recording.

Both services close BullMQ resources during shutdown and support graceful termination through the Deepkit event system.

## Redis & Configuration

All worker components share Redis connection settings derived from `BaseAppConfig` (e.g. `BULL_QUEUE`, `REDIS_HOST` or sentinel configuration). Ensure these values are populated before starting the app or dedicated worker processes.
