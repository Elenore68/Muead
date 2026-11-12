/** Error type mapped to the API error format (api-specification.md section 1.7). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field?: string; issue: string }[],
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: { field?: string; issue: string }[]) =>
  new ApiError(400, "VALIDATION_ERROR", message, details);
export const forbidden = (message = "You do not have access to this resource") => new ApiError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new ApiError(404, "NOT_FOUND", message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
