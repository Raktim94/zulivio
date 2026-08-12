import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { KnowledgeService } from "./knowledge.service";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { CreateTrainingAssignmentDto } from "./dto/create-training-assignment.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentEmployee } from "../common/decorators/current-employee.decorator";
import type { AuthenticatedEmployee } from "../common/guards/auth.guard";

@UseGuards(AuthGuard)
@Controller("api/v1/knowledge")
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get("documents")
  async list(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.knowledgeService.list(actor);
  }

  @Post("documents")
  @UseInterceptors(
    FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  async upload(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Body() dto: CreateDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.knowledgeService.uploadDocument(actor, dto, file);
  }

  @Post("documents/:id/publish")
  async publish(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.knowledgeService.publish(actor, id);
  }

  @Post("training-assignments")
  async assignTraining(
    @CurrentEmployee() actor: AuthenticatedEmployee,
    @Body() dto: CreateTrainingAssignmentDto,
  ) {
    return this.knowledgeService.assignTraining(actor, dto);
  }

  @Get("training-assignments/me")
  async myTraining(@CurrentEmployee() actor: AuthenticatedEmployee) {
    return this.knowledgeService.myTraining(actor);
  }

  @Post("training-assignments/:id/acknowledge")
  async acknowledge(@CurrentEmployee() actor: AuthenticatedEmployee, @Param("id") id: string) {
    return this.knowledgeService.acknowledge(actor, id);
  }
}
