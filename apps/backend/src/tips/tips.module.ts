import { Module } from "@nestjs/common";
import { TipsController } from "./tips.controller";
import { TipsService } from "./tips.service";

@Module({
  controllers: [TipsController],
  providers: [TipsService],
  exports: [TipsService],
})
export class TipsModule {}
