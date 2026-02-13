import { LoggerLevel } from '@deepkit/logger';
import * as Sentry from '@sentry/node';
import { compact, omit, pick } from 'lodash';
import { isNativeError } from 'util/types';

import { getAppConfig } from '../../app/resolver';
import { getTraceContext } from '../../telemetry';
import { isSentryInstalled } from '../../telemetry/sentry';
import { ArrowFunctionNoArgs, VoidFunction } from '../../types';

export const SentryLiftKeysToTagsFromLoggerContext = [];

export interface DecoratedError extends Error {
    cause?: Error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: Record<string, any>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isError(e: any): e is Error {
    return e instanceof Error || isNativeError(e);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getErrorMessage(e: any): string {
    return isError(e) ? e.message : String(e);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toError(e: any, cause?: any): Error {
    const baseError = isError(e) ? e : new Error(String(e));
    if (cause) {
        (baseError as DecoratedError).cause = toError(cause);
    }
    return baseError;
}

export function tryOrErrorSync<T extends ArrowFunctionNoArgs>(fn: T): ReturnType<T> | Error {
    try {
        return fn();
    } catch (e) {
        return toError(e);
    }
}

export async function tryOrError<T extends ArrowFunctionNoArgs>(fn: T): Promise<ReturnType<T> | Error> {
    try {
        return await fn();
    } catch (e) {
        return toError(e);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tryWithReject<T extends (reject: VoidFunction) => Promise<any>>(fn: T): Promise<ReturnType<T>> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
        try {
            resolve(await fn(reject));
        } catch (e) {
            reject(e);
        }
    });
}

export interface IErrorContext {
    scope?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scopeData?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loggerContext?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: Record<string, any>;
}
const errorHandlerState: { reporter?: (level: LoggerLevel, err: Error, context: IErrorContext) => void } = {};
export function setGlobalErrorReporter(reporter: (label: LoggerLevel, err: Error, context: IErrorContext) => void) {
    errorHandlerState.reporter = reporter;
}
export function reportError(level: LoggerLevel, err: Error, context: IErrorContext) {
    if (errorHandlerState.reporter) {
        errorHandlerState.reporter(level, err, context);
    }
    if (isSentryInstalled()) {
        const tags = context.loggerContext ? pick(context.loggerContext, SentryLiftKeysToTagsFromLoggerContext) : {};
        const Details = {
            ...context,
            loggerContext: omit(context.loggerContext, SentryLiftKeysToTagsFromLoggerContext)
        };
        Sentry.captureException(err, {
            tags,
            extra: { Details },
            level: level === LoggerLevel.alert ? 'fatal' : level === LoggerLevel.warning ? 'warning' : 'error'
        });
    }
    if (level === LoggerLevel.alert) {
        sendSlackAlertNotification(err, context);
    }
}

async function sendSlackAlertNotification(err: DecoratedError, context: IErrorContext) {
    try {
        const traceContext = getTraceContext();
        const url = getAppConfig().ALERTS_SLACK_WEBHOOK_URL;
        if (!url) return;

        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: compact([`:rotating_light: *${err.message}*`, err.cause && `cause: ${err.cause.message}`]).join('\n'),
                attachments: [
                    {
                        color: 'danger',
                        fields: compact([
                            context.scope && {
                                title: 'Scope',
                                value: context.scope,
                                short: true
                            },
                            traceContext && {
                                title: 'Trace ID',
                                value: traceContext.traceId,
                                short: true
                            },
                            context.data && {
                                title: 'Alert Data',
                                value: JSON.stringify(context.data, null, 2),
                                short: false
                            },
                            err.context && {
                                title: 'Error Context',
                                value: JSON.stringify(err.context, null, 2),
                                short: false
                            },
                            context.scopeData && {
                                title: 'Scope Data',
                                value: JSON.stringify(context.scopeData, null, 2),
                                short: false
                            },
                            context.loggerContext && {
                                title: 'Logger Context',
                                value: JSON.stringify(context.loggerContext, null, 2),
                                short: false
                            }
                        ])
                    }
                ]
            })
        });
    } catch (err) {
        console.error('Failed to send slack alert notification', err);
    }
}
