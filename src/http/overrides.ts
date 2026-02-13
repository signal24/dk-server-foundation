import { HttpRequest } from '@deepkit/http';

import { getAppConfig } from '../app/resolver';

/**
 * HttpRequest.getRemoteAddress
 * override to enable x-real-ip header
 */
let useRealIpHeader: boolean | null = null;
HttpRequest.prototype.getRemoteAddress = function () {
    if (useRealIpHeader === null) {
        useRealIpHeader = !!getAppConfig().USE_REAL_IP_HEADER;
    }

    if (this.headers['x-real-ip'] && useRealIpHeader) {
        return this.headers['x-real-ip'] as string;
    }

    return this.socket.remoteAddress ?? '';
};
