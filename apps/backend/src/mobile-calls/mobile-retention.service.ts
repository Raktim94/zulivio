import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MobileCallsQueryService } from "./mobile-calls-query.service";

@Injectable()
export class MobileRetentionService {
  private readonly logger = new Logger(MobileRetentionService.name);

  constructor(private readonly query: MobileCallsQueryService) {}

  /** Deletes calls past each organization's configured retention window. */
  @Cron("30 3 * * *")
  async sweep() {
    try {
      const purged = await this.query.purgeExpired();
      if (purged > 0) this.logger.log(`Retention sweep removed ${purged} call records`);
    } catch (err) {
      this.logger.error(`Retention sweep failed: ${(err as Error).name}`);
    }
  }
}
