import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MobileDeviceGuard } from "../mobile-calls/mobile-device.guard";
import { MobileAuthController } from "./mobile-auth.controller";
import { MobileAuthService } from "./mobile-auth.service";

@Module({
  imports: [AuthModule],
  controllers: [MobileAuthController],
  providers: [MobileAuthService, MobileDeviceGuard],
})
export class MobileAuthModule {}
