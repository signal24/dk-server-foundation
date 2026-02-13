import { http } from '@deepkit/http';

import { getPackageVersion } from '../helpers';
import { HealthcheckService } from './healthcheck.service';

@http.controller('/healthz')
export class HealthcheckController {
    private appVersion = getPackageVersion() ?? 'unknown';

    constructor(private healthcheckService: HealthcheckService) {}

    @http.GET()
    public async index(): Promise<{ version: string }> {
        await this.healthcheckService.check();
        return { version: this.appVersion };
    }
}
