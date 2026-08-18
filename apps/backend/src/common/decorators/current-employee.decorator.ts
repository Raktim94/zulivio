import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { AuthenticatedEmployee } from "../guards/auth.guard";

export const CurrentEmployee = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedEmployee => {
    const request: Request = ctx.switchToHttp().getRequest();
    // AuthGuard (global APP_GUARD) always populates this before a handler
    // using @CurrentEmployee() runs, unless the route is @Public().
    return request.employee!;
  },
);
