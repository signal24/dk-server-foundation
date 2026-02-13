import { HttpRequest } from '@deepkit/http';
import { uuid } from '@deepkit/type';

export const DefaultHttpContextProvider: (request: HttpRequest) => Record<string, string> = () => ({
    reqId: uuid()
});

let httpContextProvider: (request: HttpRequest) => Record<string, string> = DefaultHttpContextProvider;
export function setHttpContextResolver(provider: (request: HttpRequest) => Record<string, string>) {
    httpContextProvider = provider;
}

export function getHttpContextResolver() {
    return httpContextProvider;
}
