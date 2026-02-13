import { createHttpError } from '@deepkit/http';

export const HttpUserError = createHttpError(422);

// todo: Deepkit has added the original error prop to the event and we can use normal workflow to handle this now

// Deepkit's built in HttpAccessDeniedError fires a special workflow event
// that doesn't contain the original error or the message that was attached to it
export const HttpDetailedAccessDeniedError = createHttpError(403);
