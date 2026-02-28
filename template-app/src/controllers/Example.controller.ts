import { http, HttpBody } from '@deepkit/http';

import { ExampleService } from '../services/Example.service';

@http.controller('examples')
export class ExampleController {
    constructor(private exampleService: ExampleService) {}

    @http.GET()
    async list() {
        return this.exampleService.findAll();
    }

    @http.POST()
    async create(body: HttpBody<{ name: string }>) {
        return this.exampleService.create(body.name);
    }
}
