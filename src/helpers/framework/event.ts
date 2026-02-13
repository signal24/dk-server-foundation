import { ClassType } from '@deepkit/core';
import { eventClass, eventDispatcher } from '@deepkit/event';

export function applyParentEventHandlers(target: ClassType) {
    const parent = Object.getPrototypeOf(target);
    const config = eventClass._fetch(parent);
    config?.listeners.forEach(listener => {
        eventDispatcher.listen(listener.eventToken, listener.order)(target.prototype, listener.methodName);
    });
    return target;
}
