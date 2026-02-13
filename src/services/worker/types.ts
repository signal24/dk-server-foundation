import { ClassType } from '@deepkit/core';

import { createRegistryClassDecorator } from '../../helpers/framework/decorators';

export const JobSymbol = Symbol('Job');
export const InputDataSymbol = Symbol('InputData');
export const OutputDataSymbol = Symbol('OutputData');

export const WorkerSymbol = Symbol('Worker');
export const WorkerJob = createRegistryClassDecorator(WorkerSymbol);

export abstract class BaseJob<I = void, O = void> {
    [JobSymbol] = JobSymbol;
    [InputDataSymbol]!: I;
    [OutputDataSymbol]!: O;

    static QUEUE_NAME = 'default';
    static CRON_SCHEDULE: string | null = null;

    abstract handle(data: I): Promise<O>;
}

export interface BaseJobClass {
    QUEUE_NAME: string;
    CRON_SCHEDULE: string | null;
}

export type JobClass = ClassType<BaseJob> & BaseJobClass;

export interface IJobOptions {
    delay?: number;
}
