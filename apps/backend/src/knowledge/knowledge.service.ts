import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DocumentStatus, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { CreateTrainingAssignmentDto } from "./dto/create-training-assignment.dto";

const MANAGER_RANK: Role[] = [Role.MANAGER, Role.SALES_HEAD, Role.COMPANY_ADMIN, Role.MASTER_OWNER];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const UPLOAD_ROOT = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  private requireManager(actor: AuthenticatedEmployee) {
    if (!MANAGER_RANK.includes(actor.role)) {
      throw new ForbiddenException("Only managers and above can manage knowledge documents");
    }
  }

  async uploadDocument(actor: AuthenticatedEmployee, dto: CreateDocumentDto, file: Express.Multer.File) {
    this.requireManager(actor);

    if (!file) throw new BadRequestException("A PDF file is required");
    if (file.mimetype !== "application/pdf") {
      throw new BadRequestException("Only application/pdf uploads are accepted");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException("File exceeds the 25MB limit");
    }

    const orgDir = path.join(UPLOAD_ROOT, actor.organizationId, "knowledge");
    await fs.mkdir(orgDir, { recursive: true });
    const storageKey = path.join(actor.organizationId, "knowledge", `${randomUUID()}.pdf`);
    await fs.writeFile(path.join(UPLOAD_ROOT, storageKey), file.buffer);

    return this.prisma.knowledgeDocument.create({
      data: {
        organizationId: actor.organizationId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        storageKey,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        ownerId: actor.id,
      },
    });
  }

  async publish(actor: AuthenticatedEmployee, id: string) {
    this.requireManager(actor);
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!doc) throw new NotFoundException("Document not found");

    return this.prisma.knowledgeDocument.update({
      where: { id },
      data: { status: DocumentStatus.PUBLISHED },
    });
  }

  async list(actor: AuthenticatedEmployee) {
    const isManager = MANAGER_RANK.includes(actor.role);
    return this.prisma.knowledgeDocument.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(isManager ? {} : { status: DocumentStatus.PUBLISHED }),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async assignTraining(actor: AuthenticatedEmployee, dto: CreateTrainingAssignmentDto) {
    this.requireManager(actor);
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id: dto.documentId, organizationId: actor.organizationId },
    });
    if (!doc) throw new NotFoundException("Document not found");

    return this.prisma.trainingAssignment.create({
      data: {
        documentId: dto.documentId,
        targetRole: dto.targetRole,
        targetEmployeeId: dto.targetEmployeeId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });
  }

  /** Training assigned to the current employee (by role or by name) plus its acknowledgement state. */
  async myTraining(actor: AuthenticatedEmployee) {
    const assignments = await this.prisma.trainingAssignment.findMany({
      where: {
        OR: [{ targetRole: actor.role }, { targetEmployeeId: actor.id }],
        document: { organizationId: actor.organizationId, status: DocumentStatus.PUBLISHED },
      },
      include: {
        document: true,
        results: { where: { employeeId: actor.id } },
      },
      orderBy: { createdAt: "desc" },
    });

    return assignments.map((a) => ({
      id: a.id,
      document: { id: a.document.id, title: a.document.title, version: a.document.version },
      dueAt: a.dueAt,
      acknowledgedAt: a.results[0]?.acknowledgedAt ?? null,
    }));
  }

  async acknowledge(actor: AuthenticatedEmployee, trainingAssignmentId: string) {
    const assignment = await this.prisma.trainingAssignment.findFirst({
      where: { id: trainingAssignmentId },
      include: { document: true },
    });
    if (!assignment || assignment.document.organizationId !== actor.organizationId) {
      throw new NotFoundException("Training assignment not found");
    }

    return this.prisma.trainingResult.upsert({
      where: {
        trainingAssignmentId_employeeId: {
          trainingAssignmentId,
          employeeId: actor.id,
        },
      },
      create: {
        trainingAssignmentId,
        employeeId: actor.id,
        acknowledgedAt: new Date(),
        documentVersion: assignment.document.version,
      },
      update: {
        acknowledgedAt: new Date(),
        documentVersion: assignment.document.version,
      },
    });
  }
}
