# Helper Utilities

Utilities in `src/helpers/` provide small, framework-aware building blocks that other packages import. They are intentionally lightweight and map 1:1 to the functions exported from this directory—use the references below to find the right helper.

## Directory Layout

- **async/** – Request-scoped context helpers, simple async primitives, and process execution.
- **data/** – Array/object helpers, JSON serialization wrappers, and the `Transformer` utility.
- **redis/** – Redis client wiring, cache helpers, mutex orchestration, and lightweight broadcast utilities.
- **security/** – Randomness helpers and basic validation guards.
- **io/** – Package metadata helpers and stream utilities.
- **framework/** – Deepkit-specific helpers for events and dependency injection.
- **utils/** – Miscellaneous helpers for dates, error reporting, JSX rendering, and UUID generation.

Import everything from `src/helpers/index.ts` unless you need a specific module.

## Key Modules

### Async (`async/`)

- `context.ts` – Wrap work in an `AsyncLocalStorage` scope via `withContext()` or augment existing scope data with `withContextData()`. `getContext()`, `setContextProp()`, and `removeContextProp()` expose the active store.
- `promise.ts` – `createSemaphore()` returns a simple async semaphore that resolves once released.
- `process.ts` – `execProcess()` runs a child process with optional tracing hooks and throws wrapped errors that include the invoked command.

### Redis (`redis/`)

- `redis.ts` – `createRedisOptions()` and `createRedis()` build `ioredis` clients using app configuration (supports sentinel and conventional hosts).
- `cache.ts` – `Cache.get()/set()` and `Cache.getObj()/setObj()` read or write Redis-backed cache entries with an optional TTL.
- `mutex.ts` – `withMutex()`/`withMutexes()` coordinate local or Redis-backed locks, throwing `MutexAcquisitionError` on timeout. `flattenMutexKey()` normalises composite keys.
- `broadcast.ts` – `createBroadcastChannel()` publishes or subscribes to named Redis pub/sub channels, and `createDistributedMethod()` mirrors local method calls across processes.

### Data (`data/`)

- `array.ts` – `toArray()` normalises single values into arrays; `asyncMap()` awaits sequential async operations.
- `objects.ts` – Helpers such as `extractUpdates()` and `patchObject()` compute or apply partial updates while respecting deep equality rules.
- `serialization.ts` – `toJson()` / `fromJson()` thin wrappers over `JSON.stringify/parse` for types that extend the shared `Serializable` contract.
- `transformer.ts` – Chainable `Transformer` class for building transformation pipelines (`apply`, `applyEach`, `narrow`, `execute`).

### Security (`security/`)

- `crypto.ts` – `randomBytes`, `randomString`, and the static `Crypto` class (AES-256-GCM encrypt/decrypt) rely on `CRYPTO_SECRET` and `CRYPTO_IV_LENGTH`.
- `validation.ts` – `validateOrThrow()` executes Deepkit validation and throws when errors exist; `assertInput()` guards required fields with HTTP 400 errors.

### I/O (`io/`)

- `package.ts` – `getPackageJson()`, `getPackageVersion()`, and `getPackageName()` read `package.json` once (memoised).
- `stream.ts` – `safePipe()` provides a promise-based pipe with error propagation, and `withResourceCleanup()` tracks temporary files/streams for automatic cleanup after async work.

### Framework (`framework/`)

- `event.ts` – `applyParentEventHandlers()` copies Deepkit event listeners declared on parent classes, ensuring subclass inheritance works.
- `injection.ts` – `getProviderTree()` inspects `InjectorModule` hierarchies and returns visible provider metadata.

### Misc Utilities (`utils/`)

- `date.ts` – `extractDate()` formats dates as `yyyy-MM-dd`; `sleepMs()`/`sleepSecs()` provide simple timers.
- `error.ts` – Error helpers (`toError`, `reportError`, `setGlobalErrorReporter`, etc.) integrate with Sentry and optional Slack alerts.
- `jsx.ts` – `jsxToHtml()` renders Deepkit JSX templates using the application injector.
- `uuid.ts` – `uuid7` re-exports the UUID v7 generator.

## Tests

Relevant specs live under `tests/helpers/` (`array.spec.ts`, `objects.spec.ts`, `promise.spec.ts`, `mutex.spec.ts`, `error.spec.ts`, `stream.spec.ts`, etc.). Check these for concrete usage examples.

## Configuration Inputs

Some helpers expect configuration via `BaseAppConfig`:

- Redis-based helpers read `REDIS_*`, `CACHE_REDIS_*`, `BROADCAST_REDIS_*`, or `MUTEX_*` values.
- Crypto helpers require `CRYPTO_SECRET` (32 bytes or 64 char hex) and `CRYPTO_IV_LENGTH`.
- Error helpers optionally use `ALERTS_SLACK_WEBHOOK_URL` when emitting alert-level notifications.
