import { uuidv7, V7Generator } from 'uuidv7';

export const uuid7 = uuidv7;

const v7Generator = new V7Generator();
export const uuid7FromDate = (date: Date) => {
    return v7Generator.generateOrResetCore(date.getTime(), 10_000).toString();
};
