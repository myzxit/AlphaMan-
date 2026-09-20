export class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function assert(cond, status, message) {
  if (!cond) throw new ApiError(status, message);
}
