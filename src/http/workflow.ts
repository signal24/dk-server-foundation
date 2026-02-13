import { asyncOperation } from '@deepkit/core';
import { eventDispatcher } from '@deepkit/event';
import { HttpBadRequestError, HttpError, HttpRequest, HttpRouter, httpWorkflow, JSONResponse } from '@deepkit/http';
import { LoggerInterface } from '@deepkit/logger';
import { ValidationError } from '@deepkit/type';

import { DecoratedError } from '../helpers';
import { setSpanAttributes } from '../telemetry/otel/helpers';

export class HttpWorkflowListenerOptions {
    logRequestBodyOnError: boolean = process.env.NODE_ENV !== 'production';
}

export class HttpWorkflowListener {
    constructor(
        protected router: HttpRouter,
        protected logger: LoggerInterface,
        protected options: HttpWorkflowListenerOptions
    ) {}

    // this is a copy of the default onRoute, with the timeouts removed, because
    // we sometimes use middleware to easily express various security requirements, and allowing a timeout
    // during a time of delayed response due to any number of factors (such as DB load) is a security risk
    // having a priority of 99 and dispatching a "next" ensures the default handler doesn't do anything
    @eventDispatcher.listen(httpWorkflow.onRoute, 99)
    async onRouteOverride(event: typeof httpWorkflow.onRoute.event) {
        if (event.sent) return;
        if (event.hasNext()) return;

        try {
            const resolved = this.router.resolveRequest(event.request);
            if (resolved) {
                event.request.uploadedFiles = resolved.uploadedFiles;

                if (resolved.middlewares) {
                    const middlewares = resolved.middlewares(event.injectorContext);
                    if (middlewares.length) {
                        await asyncOperation(async (resolve, reject) => {
                            function finish() {
                                resolve(undefined);
                            }

                            event.response.once('finish', finish);
                            let i = -1;

                            async function next() {
                                i++;
                                if (i >= middlewares.length) {
                                    event.response.off('finish', finish);
                                    resolve(undefined);
                                    return;
                                }

                                try {
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    await middlewares[i].fn(event.request, event.response, (error?: any) => {
                                        if (error) {
                                            event.response.off('finish', finish);
                                            reject(error);
                                        } else {
                                            next();
                                        }
                                    });
                                } catch (error) {
                                    reject(error);
                                }
                            }

                            await next();
                        });
                    }
                }

                event.routeFound(resolved.routeConfig, resolved.parameters);
            }
        } catch (error) {
            this.logger.error('Could not resolve request', error);
            event.notFound();
        }
    }

    // the default behavior for parameter resolver and controllers encountering HttpError
    // is to return a JSONResponse with the error message in the "message" field. we want to use
    // the "error" field, so override them both here
    @eventDispatcher.listen(httpWorkflow.onParametersFailed)
    onParametersFailed(event: typeof httpWorkflow.onParametersFailed.event) {
        if (event.error instanceof ValidationError) {
            this.logger.warn('Request parameters error', {
                type: 'validation',
                err: event.error.message,
                requestBody: this.getRequestBodyForErrorLogging(event.request)
            });

            // JSON parse errors should be treated as 400s
        } else if (event.error instanceof SyntaxError && event.error.message.includes('JSON')) {
            this.logger.warn('Request parameters error ', { type: 'json', requestBody: this.getRequestBodyForErrorLogging(event.request) });
            event.error = new HttpBadRequestError('Failed to parse JSON');

            // all other errors should include the request body as error context
        } else if (!(event.error instanceof HttpError)) {
            this.decorateErrorWithRequest(event.error, event.request);
        }

        return this.handleHttpErrorFromEvent(event);
    }

    @eventDispatcher.listen(httpWorkflow.onControllerError)
    onControllerError(event: typeof httpWorkflow.onControllerError.event) {
        // ValidationErrors should only render as HTTP 400 when it's in the query or body, which is handled by
        // parameters processing. validation errors within the controller body are internal errors and should be treated
        // as 500s
        if (event.error instanceof ValidationError) {
            const originalError = event.error;
            event.error = new Error('Validation failure within controller');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (event.error as any).cause = originalError;
        }

        if (event.sent && event.response.statusCode < 400) {
            if (event.response.chunkedEncoding) {
                event.response.write('\n\nINTERNAL SERVER ERROR\n\n', () => {
                    event.response.destroy();
                });
            } else {
                // not safe to write more data if we're not using chunked encoding
                event.response.destroy();
            }
            this.logger.error('Controller error after response sent', event.error);
            return;
        }

        this.handleHttpErrorFromEvent(event);

        if (!event.sent) {
            this.decorateErrorWithRequest(event.error, event.request);
        }
    }

    private handleHttpErrorFromEvent(event: typeof httpWorkflow.onParametersFailed.event | typeof httpWorkflow.onControllerError.event) {
        if (event.error instanceof HttpError) {
            setSpanAttributes({ 'error.message': event.error.message });
            this.logger.warn('Request processing error', { 'error.message': event.error.message });
            event.stopImmediatePropagation();
            event.send(
                new JSONResponse(
                    {
                        error: event.error.message
                    },
                    event.error.httpCode
                ).disableAutoSerializing()
            );
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private decorateErrorWithRequest(error: any, request: HttpRequest) {
        (error as DecoratedError).context = {
            ...(error as DecoratedError).context,
            requestBody: this.getRequestBodyForErrorLogging(request)
        };
    }

    private getRequestBodyForErrorLogging(request: HttpRequest) {
        if (!this.options.logRequestBodyOnError) return undefined;
        return request.body?.toString().slice(0, 4096);
    }
}
