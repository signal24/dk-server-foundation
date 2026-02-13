import { TypeAnnotation } from '@deepkit/core';
import { ReflectionKind, serializer, typeAnnotation, Validate, ValidatorError } from '@deepkit/type';
import { PhoneNumberFormat, PhoneNumberUtil } from 'google-libphonenumber';

import { tryOrErrorSync } from '../helpers';

const PhoneFormatter = PhoneNumberUtil.getInstance();
const InvalidPhoneSymbol = '¡InvalidPhone¡'; //Symbol('InvalidPhone');

export function cleanPhone(value: string, country: string = 'US'): string | null {
    const cleaned = cleanPhoneInternal(value, country);
    return cleaned === InvalidPhoneSymbol ? null : cleaned;
}

function cleanPhoneInternal(value: string, country: string = 'US', stripUSPrefix = false): string {
    if (typeof value !== 'string') return InvalidPhoneSymbol;
    const number = tryOrErrorSync(() => PhoneFormatter.parseAndKeepRawInput(value, country));
    if (number instanceof Error) return InvalidPhoneSymbol;
    if (!PhoneFormatter.isValidNumber(number)) return InvalidPhoneSymbol;
    const result = PhoneFormatter.format(number, PhoneNumberFormat.E164);
    return stripUSPrefix ? result.replace(/^\+1/, '') : result;
}

export function formatPhoneFriendly(value: string, country?: string): string | null {
    const number = tryOrErrorSync(() => PhoneFormatter.parse(value, country));
    if (number instanceof Error) return null;
    if (!PhoneFormatter.isValidNumber(number)) return null;
    return PhoneFormatter.format(number, PhoneNumberFormat.NATIONAL);
}

function _validatePhone(value: unknown) {
    if (value === InvalidPhoneSymbol) {
        return new ValidatorError('invalidPhone', 'The phone number is invalid.');
    }
}

serializer.deserializeRegistry.addDecorator(
    t => {
        const typeType = typeAnnotation.getType(t, 'dksf:type');
        return typeType?.kind === ReflectionKind.literal && typeType.literal === 'phone';
    },
    (_type, state) => {
        state.setContext({ cleanPhoneInternal });
        state.addCodeForSetter(`
            ${state.setter} = cleanPhoneInternal(${state.accessor});
        `);
    }
);

serializer.deserializeRegistry.addDecorator(
    t => {
        const typeType = typeAnnotation.getType(t, 'dksf:type');
        return typeType?.kind === ReflectionKind.literal && typeType.literal === 'phoneNanp';
    },
    (_type, state) => {
        state.setContext({ cleanPhoneInternal });
        state.addCodeForSetter(`
            ${state.setter} = cleanPhoneInternal(${state.accessor}, 'US', true);
        `);
    }
);

export type PhoneNumber = string & Validate<typeof _validatePhone> & TypeAnnotation<'dksf:type', 'phone'>;
export type PhoneNumberNANP = string & Validate<typeof _validatePhone> & TypeAnnotation<'dksf:type', 'phoneNanp'>;
