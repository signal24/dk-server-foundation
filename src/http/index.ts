import './overrides';

export * from './auth';
export * from './context';
export * from './kernel';
export * from './workflow';
export { HttpCors } from './cors';
export * from './errors';
export * from './middleware';
export * from './store';
export * from './uploads';

export const OkResponse = { ok: true };
export type OkResponse = Promise<{ ok: true }>;

export type RedirectResponse = Promise<void>;
export type EmptyResponse = Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyResponse = Promise<any>;
