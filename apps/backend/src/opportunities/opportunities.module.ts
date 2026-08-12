import { Module } from "@nestjs/common";
import { OpportunitiesController } from "./opportunities.controller";
import { OpportunitiesService } from "./opportunities.service";
import { PipelinesModule } from "../pipelines/pipelines.module";

@Module({
  imports: [PipelinesModule],
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService],
  exports: [OpportunitiesService],
})
export class OpportunitiesModule {}
