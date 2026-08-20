import { Module } from "@nestjs/common";
import { VersionController } from "./version.controller";
import { UpdateController } from "./update.controller";
import { UpdateService } from "./update.service";

@Module({
  controllers: [VersionController, UpdateController],
  providers: [UpdateService],
})
export class SystemModule {}
