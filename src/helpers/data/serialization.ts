import { Serializable } from '../../types';

export function toJson(data: Serializable) {
    return JSON.stringify(data);
}

export function fromJson<T>(serialized: string): T {
    return JSON.parse(serialized);
}

// todo: use the serializer from WsRpc
