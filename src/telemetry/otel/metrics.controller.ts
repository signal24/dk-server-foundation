import { http, HttpRequest, Response } from '@deepkit/http';

import { AnyResponse } from '../../http';
import { OtelState } from './helpers';

function isPrivateLanIp(ip: string): boolean {
    // Handle IPv6-mapped IPv4 addresses (::ffff:x.x.x.x)
    if (ip.startsWith('::ffff:')) {
        ip = ip.slice(7);
    }

    // IPv4 private ranges
    if (ip.startsWith('10.')) return true; // 10.0.0.0/8
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true; // 172.16.0.0/12
    if (ip.startsWith('192.168.')) return true; // 192.168.0.0/16
    if (ip.startsWith('127.')) return true; // 127.0.0.0/8 (localhost)

    // IPv6 private ranges
    if (ip === '::1') return true; // localhost
    if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true; // fc00::/7 (unique local)
    if (/^fe80:/i.test(ip)) return true; // fe80::/10 (link-local)

    return false;
}

@http.controller('/metrics')
export class MetricsController {
    @http.GET()
    async getMetrics(request: HttpRequest): AnyResponse {
        const ip = request.getRemoteAddress();
        if (!isPrivateLanIp(ip)) {
            return new Response('Forbidden', 'text/plain', 403);
        }

        if (!OtelState.prometheusExporter) {
            return new Response('Metrics not available', 'text/plain', 503);
        }

        const exporter = OtelState.prometheusExporter;
        const { resourceMetrics, errors } = await exporter.collect();

        if (errors.length) {
            console.error('PrometheusExporter: metrics collection errors', ...errors);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body = (exporter as any)._serializer.serialize(resourceMetrics);
        return new Response(body, 'text/plain', 200);
    }
}
