declare module 'opentelemetry-node-metrics' {
    // unclear why I can't import @opentelemetry/api without this file blowing up
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export default function (provider: any): void;
}
