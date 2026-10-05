import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";

/** Throw from mobile ingest code to control the machine-readable error code. */
export function mobileError(status: HttpStatus, code: string, message: string): HttpException {
  return new HttpException({ code, message }, status);
}

const DEFAULT_CODES: Record<number, string> = {
  400: "INVALID_REQUEST",
  401: "INVALID_TOKEN",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
};

/**
 * Shapes every error on the phone-facing routes as
 * { success:false, error:{ code, message } } — a stable contract a native
 * client can switch on. Unknown exceptions become a generic 500: no stack
 * traces, SQL or internal messages ever reach the device.
 */
@Catch()
export class MobileApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(MobileApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      this.logger.error(exception instanceof Error ? `${exception.name}: ${exception.message}` : "Unknown error");
      response.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Internal server error." },
      });
      return;
    }

    const status = exception.getStatus();
    const body = exception.getResponse();
    let code = DEFAULT_CODES[status] ?? "ERROR";
    let message = exception.message;
    if (typeof body === "object" && body !== null) {
      const b = body as { code?: unknown; message?: unknown };
      if (typeof b.code === "string") code = b.code;
      if (typeof b.message === "string") message = b.message;
      else if (Array.isArray(b.message)) message = b.message.join(", ");
    }
    if (status === 403 && code === "FORBIDDEN") code = "DEVICE_DISABLED";
    response.status(status).json({ success: false, error: { code, message } });
  }
}
