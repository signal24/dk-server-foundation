/* eslint-disable @typescript-eslint/no-require-imports */
import { BullMQInstrumentation } from '@jenniferplusplus/opentelemetry-instrumentation-bullmq';
import { AttributeValue, diag, DiagConsoleLogger, DiagLogLevel, metrics, trace } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Instrumentation, registerInstrumentations } from '@opentelemetry/instrumentation';
import { DnsInstrumentation } from '@opentelemetry/instrumentation-dns';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { UndiciInstrumentation, UndiciRequest } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, MetricReader, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { IncomingMessage, RequestOptions } from 'http';
import OtelNodeMetrics from 'opentelemetry-node-metrics';
import { hostname } from 'os';

import { isDevelopment } from '../../app/const';
import { getPackageJson } from '../../helpers/io/package';
import { getTraceContext, OtelState, withSpan } from './helpers';
import { MariaDBInstrumentation } from './MariaDBInstrumentation';

type IHttpAttributeHook = (request: IncomingMessage) => Record<string, AttributeValue>;

export interface IOtelOptions {
    instrumentations?: Instrumentation[];
    httpIncomingRequestAttributeHook?: IHttpAttributeHook;
    /** Enable the /metrics endpoint. */
    enableMetricsEndpoint?: boolean;
}

export function init(options?: IOtelOptions) {
    const shouldInstallTraces = !!(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
    const shouldPushMetrics = !!(process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT);

    const metricsEndpointEnv = process.env.OTEL_METRICS_ENDPOINT_ENABLED;
    const metricsEndpointExplicitlyEnabled = metricsEndpointEnv === 'true' || metricsEndpointEnv === '1' || options?.enableMetricsEndpoint === true;
    const metricsEndpointExplicitlyDisabled =
        metricsEndpointEnv === 'false' || metricsEndpointEnv === '0' || options?.enableMetricsEndpoint === false;
    let shouldEnableMetricsEndpoint: boolean | undefined = metricsEndpointExplicitlyEnabled
        ? true
        : metricsEndpointExplicitlyDisabled
          ? false
          : undefined;

    if (shouldPushMetrics) {
        shouldEnableMetricsEndpoint ??= true;
    }

    const shouldInstallMetrics = shouldPushMetrics || !!shouldEnableMetricsEndpoint;

    if (!shouldInstallTraces && !shouldInstallMetrics) {
        console.log('OTEL_EXPORTER_* not configured. Not installing OpenTelemetry.');
        return;
    }

    if (process.env.OTEL_DEBUG) {
        diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
    }

    const pkgJson = getPackageJson();
    const resource = resourceFromAttributes({
        'service.name': pkgJson?.name ?? 'unk',
        'service.version': pkgJson?.version ?? 'unk',
        'deployment.environment': process.env.APP_ENV,
        'host.name': hostname(),
        'process.pid': process.pid
    });

    registerInstrumentations({
        instrumentations: [
            new HttpInstrumentation({
                startIncomingSpanHook: options?.httpIncomingRequestAttributeHook,
                ignoreIncomingRequestHook: (request: IncomingMessage) => request.url === '/healthz' || request.url === '/metrics',
                ignoreOutgoingRequestHook: (request: RequestOptions) => !!request.host?.match(/sentry\./)
            }),
            new UndiciInstrumentation({
                ignoreRequestHook: (request: UndiciRequest) => /(\/healthz|\/metrics|sentry\.)/.test(request.path)
            }),
            new DnsInstrumentation(),
            new IORedisInstrumentation(),
            new BullMQInstrumentation(),
            new MariaDBInstrumentation(),
            ...(options?.instrumentations ?? [])
        ]
    });

    installDkSqlTracer();

    if (shouldInstallTraces) {
        const exporter = new OTLPTraceExporter();
        const spanProcessor = isDevelopment ? new SimpleSpanProcessor(exporter) : new BatchSpanProcessor(exporter);
        const tracerProvider = new NodeTracerProvider({ resource, spanProcessors: [spanProcessor] });
        tracerProvider.register();
        trace.setGlobalTracerProvider(tracerProvider);

        OtelState.tracer = tracerProvider.getTracer('default');

        const { setHttpContextResolver } = require('../../http');
        setHttpContextResolver(() => ({
            traceId: getTraceContext()?.traceId
        }));

        const { LoggerContextProps } = require('../../services');
        LoggerContextProps.push('traceId');
    }

    if (shouldInstallMetrics) {
        const readers: MetricReader[] = [];

        if (shouldPushMetrics) {
            const otlpExporter = new OTLPMetricExporter();
            readers.push(
                new PeriodicExportingMetricReader({
                    exporter: otlpExporter,
                    exportIntervalMillis: 10_000
                })
            );
        }

        if (shouldEnableMetricsEndpoint) {
            const prometheusExporter = new PrometheusExporter({ preventServerStart: true });
            readers.push(prometheusExporter as unknown as MetricReader);
            OtelState.prometheusExporter = prometheusExporter;
        }

        const meterProvider = new MeterProvider({
            resource,
            readers
        });
        metrics.setGlobalMeterProvider(meterProvider);
        OtelNodeMetrics(meterProvider);
    }

    console.log('OpenTelemetry installed.');
}

function installDkSqlTracer() {
    if (require.cache[require.resolve('mariadb')]) {
        throw new Error('mariadb was loaded prior to SQL instrumentation injection. Please correct dependency load order.');
    }

    const { Database } = require('@deepkit/orm');
    const originalTransaction = Database.prototype.transaction;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Database.prototype.transaction = function <T>(callback: (session: any) => Promise<T>): Promise<T> {
        return withSpan('sql.transaction', () => originalTransaction.call(this, callback));
    };
}
