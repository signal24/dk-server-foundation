import { createModuleClass } from '@deepkit/app';
import { ClassType } from '@deepkit/core';

import { OtelState } from '../telemetry/otel/helpers';
import { MetricsController } from '../telemetry/otel/metrics.controller';
import { HealthcheckController } from './healthcheck.controller';
import { HealthcheckService } from './healthcheck.service';

function getHealthControllers(): ClassType[] {
    const controllers: ClassType[] = [HealthcheckController];

    if (OtelState.prometheusExporter) {
        controllers.push(MetricsController);
    }

    return controllers;
}

const HealthModuleBase = createModuleClass({
    providers: [HealthcheckService],
    exports: [HealthcheckService]
});

export class HealthModule extends HealthModuleBase {
    override process() {
        for (const controller of getHealthControllers()) {
            this.addController(controller);
        }
    }
}
