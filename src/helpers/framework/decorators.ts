import { ClassType } from '@deepkit/core';

export function createSymbolAttachmentClassDecorator(aSymbol: symbol) {
    return (): ClassDecorator => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (target: any) => {
            target[aSymbol] = aSymbol;
            return target;
        };
    };
}

const DecoratorRegistry = new Map<symbol, ClassType[]>();
export function createRegistryClassDecorator(aSymbol: symbol) {
    return (): ClassDecorator => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (target: any) => {
            const classes = DecoratorRegistry.get(aSymbol) ?? [];
            classes.push(target);
            DecoratorRegistry.set(aSymbol, classes);
            return target;
        };
    };
}
export function getRegisteredClasses<T extends ClassType>(aSymbol: symbol): T[] {
    return (DecoratorRegistry.get(aSymbol) as T[]) ?? [];
}
