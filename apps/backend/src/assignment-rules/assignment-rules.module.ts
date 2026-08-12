import { Module } from "@nestjs/common";
import { AssignmentRulesController } from "./assignment-rules.controller";
import { AssignmentRulesService } from "./assignment-rules.service";

@Module({
  controllers: [AssignmentRulesController],
  providers: [AssignmentRulesService],
  exports: [AssignmentRulesService],
})
export class AssignmentRulesModule {}
