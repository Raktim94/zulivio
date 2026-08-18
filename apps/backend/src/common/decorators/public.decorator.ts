import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Opts a route (or whole controller) out of the global AuthGuard registered
 * as APP_GUARD in app.module.ts. Use sparingly — only for routes that must
 * work before a session exists (login, org bootstrap, health checks).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
