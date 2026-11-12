export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, message, 'bad_request', details);
export const unauthorized = (message = 'Sign in to continue.') =>
  new HttpError(401, message, 'unauthorized');
export const forbidden = (message = 'You do not have access to this.') =>
  new HttpError(403, message, 'forbidden');
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`, 'not_found');
export const conflict = (message: string) => new HttpError(409, message, 'conflict');
