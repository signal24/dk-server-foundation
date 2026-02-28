import { ActiveRecord } from '@deepkit/orm';
import { AutoIncrement, entity, PrimaryKey } from '@deepkit/type';

@entity.name('examples')
export class ExampleEntity extends ActiveRecord {
    id!: number & AutoIncrement & PrimaryKey;
    name!: string;
    createdAt: Date = new Date();
}
