import { HttpError, HttpMiddleware as BaseHttpMiddleware, HttpRequest, HttpResponse } from '@deepkit/http';
import { ScopedLogger } from '@deepkit/logger';

import { CorsHeaders } from './cors';

// Deepkit's middleware code returns a 404 if the middleware throws an error
// we want to properly handle HTTP errors, so we need to wrap the middleware
export abstract class HttpMiddleware implements BaseHttpMiddleware {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(request: HttpRequest, response: HttpResponse, next: (err?: any) => void) {
        try {
            await this.handle(request, response);
            next();
        } catch (err) {
            if (err instanceof HttpError) {
                response.writeHead(err.httpCode, {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ...(response as any)[CorsHeaders],
                    'content-type': 'application/json'
                });
                response.end(
                    JSON.stringify({
                        error: err.message
                    })
                );

                // there's some quirk in Deepkit testing where the finish event isn't emitted
                // on ended responses during Jest testing, but works as expected in production
                // will submit a PR for this later. meanwhile, emit the finish event in Jest testing
                if (process.env.NODE_ENV === 'test') {
                    response.emit('finish');
                }
            } else {
                response.writeHead(500);
                response.end('Internal Server Error');

                throw err;
            }
        }
    }

    abstract handle(request: HttpRequest, response: HttpResponse): Promise<void> | void;
}

export class HttpLogPayloadMiddleware extends HttpMiddleware {
    constructor(private logger: ScopedLogger) {
        super();
    }

    async handle(request: HttpRequest, _response: HttpResponse) {
        const body = await request.readBodyText();
        this.logger.info('Logging request', {
            method: request.method,
            url: request.url,
            contentType: request.headers['content-type'] ?? '',
            body: body ?? ''
        });
    }
}
