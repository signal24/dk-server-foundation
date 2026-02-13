import { ActiveRecordClassType } from '@deepkit/orm';
import { isNonUndefined } from '@deepkit/sql';
import { ReflectionKind, resolveRuntimeType, Type, TypeProperty } from '@deepkit/type';

import { createPersistedEntity, NewEntityFields } from '../database';

export type StringifiedDates<T> = {
    [K in keyof T]: NonNullable<T[K]> extends Date ? string : T[K];
};
type IDefinedMock<T> = T & {
    [SchemaSymbol]: ActiveRecordClassType;
};

export type TestFields<T extends ActiveRecordClassType> = StringifiedDates<NewEntityFields<InstanceType<T>>>;
export type MockData<T extends ActiveRecordClassType> = IDefinedMock<TestFields<T>>;

const SchemaSymbol = Symbol('Schema');
export const defineEntityFixtures = <T extends ActiveRecordClassType, K extends PropertyKey>(
    cls: T,
    data: { [P in K]: TestFields<T> }
): { [P in K]: MockData<T> } => {
    for (const key in data) {
        Object.defineProperty(data[key], SchemaSymbol, { enumerable: false, value: cls });
    }
    return data as { [P in K]: MockData<T> };
};

const isDate = (t: Type) => t.kind === ReflectionKind.class && t.classType.name === 'Date';
export function prepareEntityFixtures<T extends ActiveRecordClassType>(entity: T, data: NewEntityFields<InstanceType<T>>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = { ...data };
    const type = resolveRuntimeType(entity);
    if (type.kind === ReflectionKind.class) {
        const props = type.types.filter(t => t.kind === ReflectionKind.property) as TypeProperty[];
        const dateProps = props
            .filter(p => {
                if (p.type.kind === ReflectionKind.class) {
                    return isDate(p.type);
                } else if (p.type.kind === ReflectionKind.union) {
                    return p.type.types.filter(isNonUndefined).every(isDate);
                }
            })
            .map(p => p.name);

        for (const prop of dateProps) {
            if (typeof result[prop] === 'string') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                result[prop] = new Date((data as any)[prop]);
            }
        }
    }
    return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadEntityFixtures(entities: IDefinedMock<any>[]) {
    // todo: group by type & inject in bulk per type
    for (const entity of entities) {
        const data = prepareEntityFixtures(entity[SchemaSymbol], entity);
        await createPersistedEntity(entity[SchemaSymbol], data);
    }
}
