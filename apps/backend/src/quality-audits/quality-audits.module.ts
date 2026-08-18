import { Module } from "@nestjs/common";
import { QualityAuditsController } from "./quality-audits.controller";
import { QualityAuditsService } from "./quality-audits.service";

@Module({
  controllers: [QualityAuditsController],
  providers: [QualityAuditsService],
  exports: [QualityAuditsService],
})
export class QualityAuditsModule {}
