import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthenticatedEmployee } from "../guards/auth.guard";

export const CurrentEmployee = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedEmployee => {
    const request = ctx.switchToHttp().getRequest();
    return request.employee;
  },
);
