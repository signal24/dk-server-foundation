# SRPC Migration Guide

This guide covers two changes:

1. Migration from protobufjs to ts-proto for code generation
2. Simplified invoke syntax

## Migration from protobufjs to ts-proto

### Why ts-proto?

- **Better TypeScript types**: ts-proto generates cleaner, more idiomatic TypeScript with proper optional fields and union types
- **Smaller bundle size**: No runtime dependency on protobufjs
- **Simpler API**: Direct encode/decode functions instead of class-based approach

### Code Generation

**Before (protobufjs):**

```bash
pbjs -t static-module -w commonjs -o proto.js proto/*.proto
pbts -o proto.d.ts proto.js
```

**After (ts-proto):**

```bash
# Server-side (with dk-server-foundation) - encode/decode included by default
dksf-gen-proto resources/proto/my-service.proto src/generated/my-service

# Or manually with protoc
protoc --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto \
  --ts_proto_out=src/generated \
  --ts_proto_opt=outputServices=false \
  --ts_proto_opt=esModuleInterop=true \
  --ts_proto_opt=outputEncodeMethods=true \
  proto/my-service.proto
```

### Type Changes

**Message types:**

```typescript
// Before (protobufjs): Classes with static methods
import { ClientMessage } from './proto';
const msg = ClientMessage.create({ requestId: '123', uEchoRequest: { message: 'hi' } });
const encoded = ClientMessage.encode(msg).finish();
const decoded = ClientMessage.decode(encoded);

// After (ts-proto): Plain objects with separate encode/decode functions
import { ClientMessage } from './generated/my-service';
const msg = { requestId: '123', uEchoRequest: { message: 'hi' } };
const encoded = ClientMessage.encode(msg).finish();
const decoded = ClientMessage.decode(encoded);
```

**Optional fields:**

```typescript
// Before (protobufjs): All fields present, empty values for unset
interface Message {
    field: string; // "" if not set
}

// After (ts-proto): Optional fields are truly optional
interface Message {
    field?: string; // undefined if not set
}
```

**Oneof fields:**

```typescript
// Before (protobufjs): Separate field + case tracking
message.uEchoRequest; // The value
message.request; // "uEchoRequest" (the case)

// After (ts-proto): Simple optional fields, only one is set
message.uEchoRequest; // The value, or undefined
message.uComplexRequest; // undefined if uEchoRequest is set
```

### SrpcClient/SrpcServer Constructor Changes

The constructor now takes the ts-proto generated message objects directly:

```typescript
// Before (protobufjs)
import { ClientMessage, ServerMessage } from './proto';
const client = new SrpcClient(
    logger,
    uri,
    ClientMessage, // protobufjs class
    ServerMessage, // protobufjs class
    clientId
);

// After (ts-proto) - same API, different import
import { ClientMessage, ServerMessage } from './generated/my-service';
const client = new SrpcClient(
    logger,
    uri,
    ClientMessage, // ts-proto const with encode/decode
    ServerMessage, // ts-proto const with encode/decode
    clientId
);
```

The interface expected is:

```typescript
interface SrpcMessageFns<T> {
    encode(message: T, writer?: BinaryWriter): BinaryWriter;
    decode(input: BinaryReader | Uint8Array, length?: number): T;
}
```

## API Syntax Changes

Both `invoke()` and `registerMessageHandler()` now use a simplified prefix-based syntax.

### `invoke()` - Client-side

**Before:**

```typescript
const response = await client.invoke('uEchoRequest', 'uEchoResponse', { message: 'hello' });
const response = await client.invoke('uEchoRequest', 'uEchoResponse', { message: 'hello' }, 5000);
```

**After:**

```typescript
const response = await client.invoke('uEcho', { message: 'hello' });
const response = await client.invoke('uEcho', { message: 'hello' }, 5000);
```

### `invoke()` - Server-side

**Before:**

```typescript
const response = await server.invoke(stream, 'dNotifyRequest', 'dNotifyResponse', { notification: 'hello' });
```

**After:**

```typescript
const response = await server.invoke(stream, 'dNotify', { notification: 'hello' });
```

### `registerMessageHandler()` - Server-side

**Before:**

```typescript
server.registerMessageHandler('uEchoRequest', 'uEchoResponse', async (stream, data) => {
    return { message: `Echo: ${data.message}` };
});
```

**After:**

```typescript
server.registerMessageHandler('uEcho', async (stream, data) => {
    return { message: `Echo: ${data.message}` };
});
```

### `registerMessageHandler()` - Client-side

**Before:**

```typescript
client.registerMessageHandler('dNotifyRequest', 'dNotifyResponse', async data => {
    return { acknowledged: true };
});
```

**After:**

```typescript
client.registerMessageHandler('dNotify', async data => {
    return { acknowledged: true };
});
```

The new syntax only requires the **prefix** (e.g., `'uEcho'`, `'dNotify'`) instead of both request and response type names. The `Request` and `Response` suffixes are automatically inferred.

## Type Definitions for Frontend Clients

If you're implementing this in a frontend client without access to `@zyno-io/dk-server-foundation`, add these type helpers to your codebase:

```typescript
/**
 * Extracts valid invoke prefixes where both `${P}Request` and `${P}Response` exist.
 * TReq = the message type you send (e.g., ClientMessage)
 * TRes = the message type you receive (e.g., ServerMessage)
 * Excludes string index signatures to prevent overly permissive typing.
 */
type InvokePrefixes<TReq, TRes> = {
    [K in keyof TReq]: K extends string ? (K extends `${infer P}Request` ? (`${P}Response` extends keyof TRes ? P : never) : never) : never;
}[keyof TReq];

/**
 * Gets the request data type for a given prefix (for sending requests).
 */
type RequestData<TReq, P extends string> = `${P}Request` extends keyof TReq ? NonNullable<TReq[`${P}Request`]> : never;

/**
 * Gets the response data type for a given prefix.
 */
type ResponseData<TRes, P extends string> = `${P}Response` extends keyof TRes ? NonNullable<TRes[`${P}Response`]> : never;

/**
 * Gets the request data type for a handler (receiving requests).
 */
type HandlerRequestData<TReq, P extends string> = `${P}Request` extends keyof TReq ? NonNullable<TReq[`${P}Request`]> : never;
```

### Updated `invoke()` Method Signature

Replace your existing invoke method with this signature:

```typescript
invoke<P extends InvokePrefixes<TClientInput, TServerOutput>>(
    prefix: P,
    data: RequestData<TClientInput, P>,
    timeoutMs = 30_000
): Promise<ResponseData<TServerOutput, P>> {
    const requestType = `${prefix}Request`;
    const resultType = `${prefix}Response`;

    // ... rest of your invoke implementation
    // Use requestType and resultType where you previously used the explicit parameters
}
```

### Updated `registerMessageHandler()` Method Signature

Replace your existing registerMessageHandler method with this signature:

```typescript
registerMessageHandler<P extends InvokePrefixes<TServerOutput, TClientInput>>(
    prefix: P,
    handler: (data: HandlerRequestData<TServerOutput, P>) => Promise<ResponseData<TClientInput, P>>
) {
    const actionType = `${prefix}Request`;
    const resultType = `${prefix}Response`;

    // ... rest of your handler registration
    // Use actionType and resultType where you previously used the explicit parameters
}
```

Where:

- `TClientInput` is your outbound message type (what the client sends, e.g., `ClientMessage`)
- `TServerOutput` is your inbound message type (what the server sends, e.g., `ServerMessage`)

### Example Implementation

```typescript
class SrpcClient<TClientInput extends BaseMessage, TServerOutput extends BaseMessage> {
    // ... other methods

    invoke<P extends InvokePrefixes<TClientInput, TServerOutput>>(
        prefix: P,
        data: RequestData<TClientInput, P>,
        timeoutMs = 30_000
    ): Promise<ResponseData<TServerOutput, P>> {
        const requestType = `${prefix}Request`;
        const resultType = `${prefix}Response`;
        const requestId = generateRequestId();

        return new Promise((resolve, reject) => {
            // Queue the request
            this.requestQueue.set(requestId, { resolve, reject });

            // Send the message
            this.send({
                requestId,
                [requestType]: data
            });

            // Set timeout
            setTimeout(() => {
                if (this.requestQueue.has(requestId)) {
                    this.requestQueue.delete(requestId);
                    reject(new Error(`Request timeout after ${timeoutMs}ms`));
                }
            }, timeoutMs);
        }).then((response: any) => {
            if (!(resultType in response)) {
                throw new Error('Invalid response from server');
            }
            return response[resultType];
        });
    }
}
```

## Migration Steps

### 1. Add the type helpers

Copy the type definitions above into your codebase (e.g., `src/srpc/types.ts`).

### 2. Update your client class

Update the `invoke()` method signature to use the new types.

### 3. Update all `invoke()` calls

Search your codebase for invoke calls and update them:

```bash
# Find all invoke calls with the old syntax
grep -rn "\.invoke\s*(\s*['\"].*Request['\"]" --include="*.ts" src/
```

For each match, change:

```typescript
// Old: 4 arguments (requestType, responseType, data, timeout?)
client.invoke('uFooRequest', 'uFooResponse', { ... })
client.invoke('uFooRequest', 'uFooResponse', { ... }, 10000)

// New: 3 arguments (prefix, data, timeout?)
client.invoke('uFoo', { ... })
client.invoke('uFoo', { ... }, 10000)
```

## Quick Reference

| Old Syntax                                                              | New Syntax                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------ |
| `client.invoke('uFooRequest', 'uFooResponse', data)`                    | `client.invoke('uFoo', data)`                    |
| `client.invoke('uFooRequest', 'uFooResponse', data, timeout)`           | `client.invoke('uFoo', data, timeout)`           |
| `server.registerMessageHandler('uFooRequest', 'uFooResponse', handler)` | `server.registerMessageHandler('uFoo', handler)` |
| `client.registerMessageHandler('dBarRequest', 'dBarResponse', handler)` | `client.registerMessageHandler('dBar', handler)` |

## Notes

- **Wire format unchanged**: Proto definitions and wire format are identical between protobufjs and ts-proto - clients using different generators can still communicate
- The prefix naming convention remains the same: `U` prefix for upstream (client-initiated) requests, `D` prefix for downstream (server-initiated) requests
- Type inference works automatically with ts-proto generated types
