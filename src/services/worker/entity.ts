import { entity, Index, PrimaryKey } from '@deepkit/type';

import { BaseEntity } from '../../database';

@entity.name('_jobs')
export class JobEntity extends BaseEntity {
    id!: string & PrimaryKey;
    queue!: string & Index;
    queueId!: string;
    attempt!: number;
    name!: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data!: any;
    traceId!: string | null;
    status!: 'completed' | 'failed';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result!: any;
    createdAt!: Date;
    shouldExecuteAt!: Date;
    executedAt!: Date;
    completedAt!: Date;
}
