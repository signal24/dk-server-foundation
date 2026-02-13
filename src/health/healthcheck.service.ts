type HealthcheckFn = () => Promise<void>;

export class HealthcheckService {
    private checks: HealthcheckFn[] = [];

    public register(fn: HealthcheckFn) {
        this.checks.push(fn);
    }

    public async check() {
        for (const check of this.checks) {
            await check();
        }
    }
}
