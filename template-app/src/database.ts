import { createMySQLDatabase } from '@zyno-io/dk-server-foundation';

import { ExampleEntity } from './entities/Example.entity';

export class DB extends createMySQLDatabase({}, [ExampleEntity]) {}
