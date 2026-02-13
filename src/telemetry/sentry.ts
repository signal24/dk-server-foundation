import * as Sentry from '@sentry/node';

import { getPackageJson } from '../helpers';
import { getTraceContext, isTracingInstalled } from './otel/helpers';

const SentryState = {
    installed: false
};
export function isSentryInstalled() {
    return SentryState.installed;
}

// eslint-disable-next-line eslint-plugin-import/namespace
export interface ISentryOptions extends Sentry.NodeOptions {
    dsn: string;
}

export function installSentry(options: ISentryOptions) {
    const { dsn, ...sentryOptions } = options;
    const pkgJson = getPackageJson();

    Sentry.init({
        dsn: dsn,
        environment: process.env.APP_ENV,
        maxBreadcrumbs: 0,
        release: pkgJson?.name?.replace(/^@.+?\//, '') + '@' + pkgJson?.version,
        skipOpenTelemetrySetup: true,
        integrations: integrations =>
            integrations.filter(integration => {
                return !['Http', 'NodeFetch'].includes(integration.name);
            }),
        ...sentryOptions
    });

    if (isTracingInstalled()) {
        Sentry.addEventProcessor(event => {
            const spanCtx = getTraceContext();
            if (spanCtx) {
                event.contexts = {
                    ...event.contexts,
                    trace: {
                        trace_id: spanCtx.traceId,
                        span_id: spanCtx.spanId
                    }
                };
            }
            return event;
        });
    }

    SentryState.installed = true;
}

export async function flushSentry() {
    if (isSentryInstalled()) {
        await Sentry.flush(5);
    }
}
