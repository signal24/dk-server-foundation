import { ClassType } from '@deepkit/core';

import { isTest } from '../../app/const';
import { createLogger } from '../logger';
import { WorkerQueueRegistry } from './queue';
import { BaseJob, IJobOptions, InputDataSymbol, JobClass } from './types';

export * from './entity';
export { BaseJob, WorkerJob } from './types';

export class WorkerService {
    private logger = createLogger(this);

    async queueJob<I extends object, O, T extends BaseJob<I, O>>(jobClass: ClassType<T>, data: T[typeof InputDataSymbol], options?: IJobOptions) {
        if (isTest) {
            this.logger.warn('Not queueing job in test environment', { jobName: jobClass.name, data, options });
            return;
        }

        try {
            const typedJob = jobClass as unknown as JobClass;
            const queue = WorkerQueueRegistry.getQueue(typedJob.QUEUE_NAME);
            const job = await queue.add(jobClass.name, data, options);
            this.logger.info('Queued job', { job: { name: jobClass.name, id: job.id } });
        } catch (err) {
            this.logger.error('Failed to queue job', err, { job: { name: jobClass.name } });
            throw err;
        }
    }
}
