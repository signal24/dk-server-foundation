import { HttpKernel, HttpRequest, HttpResponse } from '@deepkit/http';
import { LoggerInterface } from '@deepkit/logger';

import { getAppConfig } from '../app/resolver';
import { withContextData } from '../helpers';
import { createLogger } from '../services';
import { getHttpContextResolver } from './context';

interface RequestLogger {
    start?: (logger: LoggerInterface, request: HttpRequest) => void;
    finish?: (logger: LoggerInterface, request: HttpRequest, response: HttpResponse) => void;
    abort?: (logger: LoggerInterface, request: HttpRequest) => void;
}

export class CustomHttpKernel extends HttpKernel {
    private activeRequestCount = 0;
    private scopedLogger = createLogger('http');

    private shouldSkipRequestLogging(request: HttpRequest) {
        return request.url === '/healthz' || request.url === '/metrics';
    }

    private buildRequestLogger(): RequestLogger {
        const logMode = getAppConfig().HTTP_REQUEST_LOGGING_MODE;

        const abortFn: RequestLogger['abort'] = (logger, request) => {
            logger.warn('Request aborted during processing', {
                method: request.method,
                url: request.url,
                duration: Date.now() - request.store['$RequestTime']
            });
        };

        const finishFn: RequestLogger['finish'] = (logger, request, response) => {
            const msg =
                response.statusCode >= 400 ? 'Request failed' : response.writableEnded ? 'Request completed' : 'Response stream hooked by controller';
            logger.info(msg, {
                method: request.method,
                url: request.url,
                statusCode: response.statusCode,
                duration: Date.now() - request.store['$RequestTime']
            });
        };

        if (logMode === 'e2e') {
            return {
                start: (logger, request) => {
                    request.store['$RequestTime'] = Date.now();
                    if (!this.shouldSkipRequestLogging(request)) {
                        logger.info('Request started', {
                            method: request.method,
                            url: request.url,
                            remoteAddress: request.getRemoteAddress(),
                            contentLength: request.headers['content-length']
                        });
                    }
                },
                finish: (logger, request, response) => {
                    if (response.statusCode >= 400 || !this.shouldSkipRequestLogging(request)) {
                        finishFn(logger, request, response);
                    }
                },
                abort: abortFn
            };
        }

        if (logMode === 'finish') {
            return {
                start: (_logger, request) => {
                    request.store['$RequestTime'] = Date.now();
                },
                finish: (logger, request, response) => {
                    if (response.statusCode >= 400 || !this.shouldSkipRequestLogging(request)) {
                        finishFn(logger, request, response);
                    }
                }
            };
        }

        if (logMode === 'errors') {
            return {
                start: (_logger, request) => {
                    request.store['$RequestTime'] = Date.now();
                },
                finish: (logger, request, response) => {
                    if (response.statusCode >= 400) {
                        finishFn(logger, request, response);
                    }
                },
                abort: abortFn
            };
        }

        return {
            start: (_logger, request) => {
                request.store['$RequestTime'] = Date.now();
            },
            abort: abortFn
        };
    }

    get requestLogger(): RequestLogger {
        const logger = this.buildRequestLogger();
        Object.defineProperty(this, 'requestLogger', { value: logger });
        return logger;
    }

    async handleRequest(req: HttpRequest, res: HttpResponse): Promise<void> {
        try {
            this.activeRequestCount++;
            const httpCtx = getHttpContextResolver()(req);
            await withContextData({ http: httpCtx }, async () => {
                this.requestLogger.start?.(this.scopedLogger, req);

                await new Promise<void>((resolve, reject) => {
                    const onClose = () => {
                        if (res.destroyed && !res.writableFinished) {
                            this.requestLogger.abort?.(this.scopedLogger, req);
                            resolve();
                        }
                    };
                    res.on('close', onClose);

                    super
                        .handleRequest(req, res)
                        .then(() => {
                            res.removeListener('close', onClose);
                            this.requestLogger.finish?.(this.scopedLogger, req, res);
                            resolve();
                        })
                        .catch(reject);
                });
            });
        } finally {
            this.activeRequestCount--;
        }
    }
}
