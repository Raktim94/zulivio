import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

// Matches the module-augmentation pattern @types/cookie-parser itself uses
// (declare module "express" { interface Request {...} }), rather than the
// global Express.Request namespace — the express package's own exported
// Request type does not extend that namespace in @types/express 5.x.
declare module "express" {
  interface Request {
    employee?: AuthenticatedEmployee;
    sessionId?: string;
    apiKeyId?: string;
  }
}

export {};
