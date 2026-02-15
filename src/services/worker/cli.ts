import { cli } from '@deepkit/app';

import { CliServiceCommand } from '../cli';
import { WorkerQueueRegistry } from './queue';
import { WorkerRunnerService } from './runner';
import { BaseJob } from './types';

@cli.controller('worker:start', {
    description: 'Start the worker runner'
})
export class WorkerStartCommand extends CliServiceCommand {
    constructor(private runner: WorkerRunnerService) {
        super();
    }

    async startService() {
        await this.runner.start();
    }
}

@cli.controller('worker:queue', {
    // todo: optional queue name?
    description: 'Queue a job by name'
})
export class WorkerQueueJobCommand {
    async execute(jobName: string, data?: string) {
        data = data ? JSON.parse(data) : {};
        const queue = WorkerQueueRegistry.getQueue(BaseJob.QUEUE_NAME);
        await queue.add(jobName, data);
        await WorkerQueueRegistry.closeQueues();
    }
}
