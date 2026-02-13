// servers should *always* use UTC
process.env.TZ = 'UTC';
const testDate = new Date();
if (testDate.getTimezoneOffset() !== 0) {
    throw new Error('Please restart the process with the TZ environment variable set to UTC');
}

export * from './app';
export { isDevelopment, isTest } from './app/const';
export * from './auth';
export * from './database';
export * from './health';
export * from './helpers';
export * from './http';
export * from './services';
export * from './srpc';
export * from './telemetry';
export * from './testing';
export * from './types';
