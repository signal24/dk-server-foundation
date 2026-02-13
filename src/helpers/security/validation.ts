import { HttpBadRequestError } from '@deepkit/http';
import { ReceiveType, validate, ValidationError } from '@deepkit/type';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validateOrThrow<T>(data: any, type?: ReceiveType<T>): data is T {
    const errors = validate<T>(data, type);
    if (errors.length) throw new ValidationError(errors);
    return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function assertInput(value: any, field?: string): asserts value {
    if (value === undefined || value === null) {
        throw new HttpBadRequestError(field ? `${field} is required` : 'missing parameters');
    }
}
