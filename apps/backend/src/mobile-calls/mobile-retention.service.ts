import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MobileContactsService } from "../mobile-contacts/mobile-contacts.service";
import { MobileCallsQueryService } from "./mobile-calls-query.service";

@Injectable()
export class MobileRetentionService {
  private readonly logger = new Logger(MobileRetentionService.name);

  constructor(
    private readonly query: MobileCallsQueryService,
    private readonly contacts: MobileContactsService,
  ) {}

  /** Deletes calls past each organization's configured retention window. */
  @Cron("30 3 * * *")
  async sweep() {
    try {
      const purged = await this.query.purgeExpired();
      if (purged > 0) this.logger.log(`Retention sweep removed ${purged} call records`);
      const contacts = await this.contacts.purgeExpired();
      if (contacts > 0) this.logger.log(`Retention sweep removed ${contacts} imported contacts`);
    } catch (err) {
      this.logger.error(`Retention sweep failed: ${(err as Error).name}`);
    }
  }
}
