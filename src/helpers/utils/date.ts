import { format } from 'date-fns';

export function extractDate(date: Date): string {
    return format(date, 'yyyy-MM-dd');
}

export function sleepMs(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function sleepSecs(secs: number) {
    return sleepMs(secs * 1000);
}
