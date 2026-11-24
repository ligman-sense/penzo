class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  static badRequest(msg, details) { return new HttpError(400, 'BAD_REQUEST', msg, details); }
  static unauthenticated(msg = 'Please sign in to continue.') { return new HttpError(401, 'UNAUTHENTICATED', msg); }
  static forbidden(msg = 'You do not have permission to do that.') { return new HttpError(403, 'FORBIDDEN', msg); }
  static notFound(msg = "We couldn't find what you were looking for.") { return new HttpError(404, 'NOT_FOUND', msg); }
  static tooMany(msg, details) { return new HttpError(429, 'RATE_LIMITED', msg, details); }
  static invalidOtp(msg) { return new HttpError(400, 'INVALID_OTP', msg); }
  static invalidCredentials() { return new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.'); }
  static conflict(msg, details) { return new HttpError(409, 'CONFLICT', msg, details); }
  static invalidTransition(msg) { return new HttpError(409, 'INVALID_STATE_TRANSITION', msg); }
  static profileIncomplete(msg) { return new HttpError(409, 'PROFILE_INCOMPLETE', msg); }
}

module.exports = { HttpError };
