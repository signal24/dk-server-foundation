import { getClassTypeFromInstance } from '@deepkit/core';
import {
    ActiveRecord,
    ActiveRecordClassType,
    Database,
    DatabaseAdapter,
    DatabaseSession,
    FilterQuery,
    getClassState,
    getInstanceState,
    getInstanceStateFromItem
} from '@deepkit/orm';
import { SQLDatabaseAdapter } from '@deepkit/sql';
import { ReflectionClass } from '@deepkit/type';
import { compact, groupBy, keyBy, uniq } from 'lodash';

import { EntityClassFields, EntityFields, getPKFieldForEntity, getPKFieldForEntityInstance } from './common';

export function getDirtyDetails<T extends ActiveRecord, K extends keyof T>(entity: T): Record<K, { original: T[K]; current: T[K] }> {
    const classState = getClassState(ReflectionClass.from(getClassTypeFromInstance(entity)));
    const instanceState = getInstanceState(classState, entity);
    const lastSnapshot = instanceState.getSnapshot();
    const currentSnapshot = classState.snapshot(entity);
    const changeSet = classState.changeDetector(lastSnapshot, currentSnapshot, entity);
    const changedFields = Object.keys(changeSet?.$set || {});
    return Object.fromEntries(
        changedFields.map(f => [
            f,
            {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                original: (lastSnapshot as any)[f],
                current: currentSnapshot[f]
            }
        ])
    ) as Record<K, { original: T[K]; current: T[K] }>;
}

export function revertDirtyEntity(entity: ActiveRecord) {
    const original = getEntityOriginal(entity);
    for (const [field, value] of Object.entries(original)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (entity as any)[field] = value;
    }
}

export function getDirtyFields<T extends ActiveRecord>(entity: T): (keyof T)[] {
    return Object.keys(getDirtyDetails(entity)) as (keyof T)[];
}

export function isEntityDirty(entity: ActiveRecord) {
    return getDirtyFields(entity).length > 0;
}

export function isFieldDirty<T extends ActiveRecord>(entity: T, field: keyof T) {
    return getDirtyFields(entity).includes(field);
}

export function getFieldOriginal<T extends ActiveRecord, K extends keyof T>(entity: T, field: K): T[K] | undefined {
    const dirtyDetails = getDirtyDetails(entity);
    const fieldDetails = dirtyDetails[field] as { original: T[K]; current: T[K] } | undefined;
    return fieldDetails?.original;
}

export function getEntityOriginal<T extends ActiveRecord>(entity: T): EntityFields<T> {
    return getInstanceStateFromItem(entity).getSnapshot() as EntityFields<T>;
}

export class BaseEntity extends ActiveRecord {}

export type EntityPick<T extends ActiveRecord, K extends keyof EntityFields<T>> = ActiveRecord & Pick<T, K>;

interface IGetEntityOptions<Schema extends ActiveRecordClassType, Field extends keyof EntityClassFields<Schema>> {
    schema: Schema;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ids: any[];
    keyField?: Field;
    fields?: Field[];
    filter?: FilterQuery<InstanceType<Schema>>;
    txn?: DatabaseSession<DatabaseAdapter>;
}

export async function getKeyedEntities<Schema extends ActiveRecordClassType, Fields extends keyof EntityClassFields<Schema>>(
    options: IGetEntityOptions<Schema, Fields>
) {
    const { keyField, entities } = await getEntitiesByIdWithKeyName(options);
    return keyBy(entities, keyField);
}

export async function getKeyedGroupedEntities<Schema extends ActiveRecordClassType, Fields extends keyof EntityClassFields<Schema>>(
    options: IGetEntityOptions<Schema, Fields>
) {
    const { keyField, entities } = await getEntitiesByIdWithKeyName(options);
    return groupBy(entities, keyField);
}

export async function getEntitiesById<Schema extends ActiveRecordClassType, Fields extends keyof EntityClassFields<Schema>>(
    options: IGetEntityOptions<Schema, Fields>
) {
    const { entities } = await getEntitiesByIdWithKeyName(options);
    return entities;
}

export async function getEntitiesByIdWithKeyName<Schema extends ActiveRecordClassType, Fields extends keyof EntityClassFields<Schema>>({
    schema,
    ids,
    keyField,
    fields,
    filter,
    txn
}: IGetEntityOptions<Schema, Fields>) {
    type ReturnType = typeof fields extends undefined ? InstanceType<Schema> : EntityPick<InstanceType<Schema>, Fields>;

    const db: Database<SQLDatabaseAdapter> = schema.getDatabase();
    const resolvedKeyField = keyField ?? getPKFieldForEntity(schema);

    ids = uniq(compact(ids));
    if (!ids.length) {
        return {
            keyField: resolvedKeyField,
            entities: [] as ReturnType[]
        };
    }

    const query = txn ? txn.query(schema) : db.query(schema);

    const entities = fields
        ? await query
              .filter({ [resolvedKeyField]: { $in: ids }, ...filter })
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .select(...(fields as any))
              .find()
        : await query.filter({ [resolvedKeyField]: { $in: ids }, ...filter }).find();

    return {
        keyField: resolvedKeyField,
        entities: entities as ReturnType[]
    };
}

interface IResolveRelatedOptions<
    Schema extends ActiveRecord,
    IdKey extends keyof EntityFields<Schema>,
    RelatedSchema extends ActiveRecordClassType,
    RelatedKey extends string,
    RelatedFields extends keyof EntityClassFields<RelatedSchema>
> {
    src: Schema[];
    srcIdField: IdKey;
    targetField: RelatedKey;
    targetSchema: RelatedSchema;
    targetFields?: RelatedFields[];
    txn?: DatabaseSession<DatabaseAdapter>;
}

export async function resolveRelated<
    Schema extends ActiveRecord,
    IdKey extends keyof EntityFields<Schema>,
    RelatedSchema extends ActiveRecordClassType,
    RelatedKey extends string,
    RelatedFields extends keyof EntityClassFields<RelatedSchema>
>(options: IResolveRelatedOptions<Schema, IdKey, RelatedSchema, RelatedKey, RelatedFields>) {
    const { src, srcIdField, targetField, targetSchema, targetFields } = options;

    type RelatedType = typeof targetFields extends undefined ? InstanceType<RelatedSchema> : EntityPick<InstanceType<RelatedSchema>, RelatedFields>;
    type RelatedFieldType = null extends Schema[IdKey] ? { [K in RelatedKey]?: RelatedType } : { [K in RelatedKey]: RelatedType };
    type ReturnType = Omit<Schema, IdKey> & RelatedFieldType;

    if (!src.length) {
        return [] as ReturnType[];
    }

    const subentitiesById = await getKeyedEntities({
        ids: src.map(e => e[srcIdField]),
        schema: targetSchema,
        fields: targetFields,
        txn: options.txn
    });

    src.forEach(e => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e as any)[targetField] = subentitiesById[e[srcIdField] as any];
    });

    return src as ReturnType[];
}

interface IResolveRelatedByPivotOptions<
    Schema extends object,
    SrcIdField extends keyof EntityFields<Schema>,
    PivotSchema extends ActiveRecordClassType,
    PivotIdKey extends keyof EntityClassFields<PivotSchema>,
    PivotRelatedKey extends keyof EntityClassFields<PivotSchema>,
    RelatedSchema extends ActiveRecordClassType,
    RelatedKey extends string,
    RelatedFields extends keyof EntityClassFields<RelatedSchema>
> {
    src: Schema[];
    srcIdField?: SrcIdField;
    pivotSchema: PivotSchema;
    pivotIdKey: PivotIdKey;
    pivotRelatedKey: PivotRelatedKey;
    pivotFilter?: FilterQuery<InstanceType<PivotSchema>>;
    targetField: RelatedKey;
    targetSchema: RelatedSchema;
    targetFields?: RelatedFields[];
    txn?: DatabaseSession<DatabaseAdapter>;
}

export async function resolveRelatedByPivot<
    Schema extends object,
    SrcIdField extends keyof EntityFields<Schema>,
    PivotSchema extends ActiveRecordClassType,
    PivotIdKey extends keyof EntityClassFields<PivotSchema>,
    PivotRelatedKey extends keyof EntityClassFields<PivotSchema>,
    RelatedSchema extends ActiveRecordClassType,
    RelatedKey extends string,
    RelatedFields extends keyof EntityClassFields<RelatedSchema>
>(options: IResolveRelatedByPivotOptions<Schema, SrcIdField, PivotSchema, PivotIdKey, PivotRelatedKey, RelatedSchema, RelatedKey, RelatedFields>) {
    const { src, srcIdField, pivotSchema, pivotIdKey, pivotRelatedKey, pivotFilter, targetField, targetSchema, targetFields } = options;

    type RelatedType = typeof targetFields extends undefined ? InstanceType<RelatedSchema> : EntityPick<InstanceType<RelatedSchema>, RelatedFields>;
    type RelatedTypeWithPivot = RelatedType & { pivot: InstanceType<PivotSchema> };
    type RelatedFieldType = { [K in RelatedKey]: RelatedTypeWithPivot[] };
    type ReturnType = Schema & RelatedFieldType;

    if (!src.length) {
        return [] as ReturnType[];
    }

    const sourcePkField = srcIdField ?? getPKFieldForEntityInstance(src[0]);
    const pivotEntitiesBySourceId = await getKeyedGroupedEntities({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ids: src.map(e => (e as any)[sourcePkField as any]),
        schema: pivotSchema,
        keyField: pivotIdKey,
        filter: pivotFilter,
        txn: options.txn
    });

    const relatedEntitiesById = await getKeyedEntities({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ids: Object.values(pivotEntitiesBySourceId).flatMap(p => p.map(p => (p as any)[pivotRelatedKey])),
        schema: targetSchema,
        fields: targetFields,
        txn: options.txn
    });

    src.forEach(e => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e as any)[targetField] =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pivotEntitiesBySourceId[(e as any)[sourcePkField as any]]?.map(p => ({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ...relatedEntitiesById[(p as any)[pivotRelatedKey]],
                pivot: p
            })) ?? [];
    });

    return src as ReturnType[];
}

export async function resolveRelatedByPivotForOne<
    Schema extends object,
    SrcIdField extends keyof EntityFields<Schema>,
    PivotSchema extends ActiveRecordClassType,
    PivotIdKey extends keyof EntityClassFields<PivotSchema>,
    PivotRelatedKey extends keyof EntityClassFields<PivotSchema>,
    RelatedSchema extends ActiveRecordClassType,
    RelatedKey extends string,
    RelatedFields extends keyof EntityClassFields<RelatedSchema>
>(
    options: Omit<
        IResolveRelatedByPivotOptions<Schema, SrcIdField, PivotSchema, PivotIdKey, PivotRelatedKey, RelatedSchema, RelatedKey, RelatedFields>,
        'src'
    > & {
        src: Schema;
    }
) {
    return (
        await resolveRelatedByPivot({
            ...options,
            src: [options.src]
        })
    )[0];
}
