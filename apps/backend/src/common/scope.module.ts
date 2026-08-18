import { Global, Module } from "@nestjs/common";
import { EmployeeScopeService } from "./scope.service";

@Global()
@Module({
  providers: [EmployeeScopeService],
  exports: [EmployeeScopeService],
})
export class ScopeModule {}
