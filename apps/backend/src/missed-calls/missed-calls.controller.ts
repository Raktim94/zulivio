import { Body, Controller, Post } from "@nestjs/common";
import { MissedCallsService } from "./missed-calls.service";
import { RecordMissedCallDto } from "./dto/record-missed-call.dto";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

// No @Public() and no @Roles gate: this relies entirely on the global
// AuthGuard's existing Bearer-token path (see auth.guard.ts
// authenticateApiKey) — MacroDroid authenticates with a per-employee API
// key issued via POST /api/v1/api-keys/org, which resolves to that
// employee exactly like any other API-key request. No bespoke auth code.
@Controller("api/v1/integrations/macrodroid")
export class MissedCallsController {
  constructor(private readonly missedCallsService: MissedCallsService) {}

  @Post("missed-call")
  async missedCall(@CurrentEmployee() actor: AuthenticatedEmployee, @Body() dto: RecordMissedCallDto) {
    return this.missedCallsService.record(actor, dto);
  }
}
