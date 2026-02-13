import { TypeAnnotation } from '@deepkit/core';
import { DatabaseField, MinLength, Pattern, serializer, typeAnnotation, Validate, ValidatorError } from '@deepkit/type';

export * from './phone';

export type ConcretePrimitive = string | number | boolean;
export type DefinedPrimitive = ConcretePrimitive | null;
export type Primitive = DefinedPrimitive | undefined;
export type StrictBool = true | false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KVObject<T = any> = Record<string, T>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NestedKVObject<T = any> = KVObject<T | T[] | KVObject<T>>;
export type Serializable<T = ConcretePrimitive> = T | T[] | NestedKVObject<T> | NestedKVObject<T>[];

export type RequireFields<T, K extends keyof T> = T & {
    [P in K]-?: T[P];
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ObjectKeysMatching<O extends {}, V> = { [K in keyof O]: O[K] extends V ? K : V extends O[K] ? K : never }[keyof O];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ArrowFunction = (...args: any) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ArrowFunctionNoArgs = () => any;
export type VoidFunction = () => void;

type IfAny<T, Y, N> = 0 extends 1 & T ? Y : N;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DefinitelyFunction<T> = IfAny<T, never, T extends (...args: any[]) => any ? T : never>;
export type MethodsOf<T> = {
    [K in keyof T as DefinitelyFunction<T[K]> extends never ? never : K]: T[K];
};
export type MethodKeys<T> = keyof MethodsOf<T>;

const _dateStringPattern = /^\d{4}-\d{2}-\d{2}$/;
export type DateString = string & Pattern<typeof _dateStringPattern> & DatabaseField<{ type: 'DATE' }> & TypeAnnotation<'dksf:type', 'date'>;

export type OnUpdate<T extends string> = TypeAnnotation<'dksf:onUpdate', T>;

export type ValidDate = Date & Validate<typeof _validateDate>;
function _validateDate(value: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(value instanceof Date) || isNaN(value as any)) {
        return new ValidatorError('invalidDate', 'The date invalid.');
    }
}

// trimmed string
export type TrimmedString = string & TypeAnnotation<'dksf:trim'>;
export type NonEmptyTrimmedString = TrimmedString & MinLength<1>;
serializer.deserializeRegistry.addDecorator(
    t => typeAnnotation.getType(t, 'dksf:trim') !== undefined,
    (_type, state) => {
        state.addSetter(`${state.accessor}.trim()`);
    }
);

// email
// DK's doesn't do a full FQDN w/TLD check
// https://github.com/deepkit/deepkit-framework/pull/558
export const EMAIL_REGEX = /^[a-z0-9_+.-]+@[a-z0-9-.]+\.[a-z]+$/i;
export type EmailAddress = string & Pattern<typeof EMAIL_REGEX>;
