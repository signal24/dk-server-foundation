import { pick } from 'lodash';

import { asyncMap } from './array';

export class Transformer<I> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private executor?: (input: I[]) => any[] | Promise<any[]>;

    static create<I>(input: I[]): Transformer<I> {
        return new Transformer(input);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private input: I[] | Transformer<any>) {}

    apply<O>(fn: (input: I[]) => O[] | Promise<O[]>, shouldApply = true): Transformer<O> {
        this.executor = shouldApply ? fn : input => input;
        return new Transformer<O>(this);
    }

    applyEach<O>(fn: (input: I) => O, shouldApply = true): Transformer<O> {
        return this.apply(arr => arr.map(fn), shouldApply);
    }

    applyEachAsync<O>(fn: (input: I) => Promise<O>, shouldApply = true): Transformer<O> {
        return this.apply(arr => asyncMap(arr, fn), shouldApply);
    }

    narrow<K extends (keyof I)[]>(...keys: K): Transformer<Pick<I, K[number]>> {
        return this.apply(input => {
            return input.map(i => {
                return pick(i, ...keys) as Pick<I, K[number]>;
            });
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(): Promise<any[]> {
        if (!this.executor) {
            throw new Error('No executor defined');
        }

        const input = await this.get();
        return this.executor(input);
    }

    async get(): Promise<I[]> {
        if (this.input instanceof Transformer) {
            return await this.input.execute();
        } else {
            return this.input;
        }
    }
}
