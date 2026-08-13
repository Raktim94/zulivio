import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { parse } from "csv-parse/sync";
import { Prisma, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { EmployeesService } from "../employees/employees.service";
import { AssignmentsService } from "../assignments/assignments.service";
import { LeadsService } from "../leads/leads.service";
import { OpportunitiesService } from "../opportunities/opportunities.service";
import { GoogleSheetsService } from "./google-sheets.service";
import { toCsv } from "./csv.util";
import { GoogleSheetsSyncDto } from "./dto/google-sheets-sync.dto";

const MANAGER_RANK: Role[] = [Role.MANAGER, Role.SALES_HEAD, Role.COMPANY_ADMIN, Role.MASTER_OWNER];
const EMPLOYEE_COLUMNS = ["employeeNumber", "fullName", "email", "role", "department", "employmentStatus"];
const ASSIGNMENT_COLUMNS = ["assignmentNumber", "title", "status", "priority", "owner", "dueAt"];
const LEAD_COLUMNS = ["fullName", "email", "phone", "company", "source", "territory", "status", "owner"];
const OPPORTUNITY_COLUMNS = [
  "title",
  "company",
  "amountMinor",
  "currency",
  "stage",
  "status",
  "forecastCategory",
  "owner",
  "expectedCloseDate",
];

export interface RowError {
  row: number;
  message: string;
}

/**
 * CSV headers exported by Excel/Google Sheets ("Full Name", "E-mail") don't
 * match our snake_case/camelCase field names byte-for-byte, so a naive
 * `raw.full_name` lookup silently fails the whole row. Normalize every
 * header key to lowercase-alphanumeric-only before matching against a list
 * of accepted aliases, so casing/spacing/punctuation differences don't
 * produce a false "missing field" error.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickField(raw: Record<string, string>, aliases: string[]): string | undefined {
  const normalized = new Map(Object.entries(raw).map(([k, v]) => [normalizeKey(k), v]));
  for (const alias of aliases) {
    const value = normalized.get(normalizeKey(alias))?.trim();
    if (value) return value;
  }
  return undefined;
}

@Injectable()
export class ImportExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly assignmentsService: AssignmentsService,
    private readonly leadsService: LeadsService,
    private readonly opportunitiesService: OpportunitiesService,
    private readonly googleSheets: GoogleSheetsService,
  ) {}

  private requireManager(actor: AuthenticatedEmployee) {
    if (!MANAGER_RANK.includes(actor.role)) {
      throw new ForbiddenException("Import/export is restricted to managers and above");
    }
  }

  async exportEmployeesCsv(actor: AuthenticatedEmployee): Promise<string> {
    this.requireManager(actor);
    const employees = await this.employeesService.list(actor);
    return toCsv(employees, EMPLOYEE_COLUMNS);
  }

  async exportAssignmentsCsv(actor: AuthenticatedEmployee): Promise<string> {
    this.requireManager(actor);
    const assignments = await this.assignmentsService.list(actor, {});
    const rows = assignments.map((a) => ({
      assignmentNumber: a.assignmentNumber,
      title: a.title,
      status: a.status,
      priority: a.priority,
      owner: a.owner?.fullName ?? "",
      dueAt: a.dueAt ? a.dueAt.toISOString() : "",
    }));
    return toCsv(rows, ASSIGNMENT_COLUMNS);
  }

  async exportLeadsCsv(actor: AuthenticatedEmployee): Promise<string> {
    this.requireManager(actor);
    const leads = await this.leadsService.list(actor, {});
    const rows = leads.map((l) => ({
      fullName: l.fullName,
      email: l.email ?? "",
      phone: l.phone ?? "",
      company: l.company ?? "",
      source: l.source ?? "",
      territory: l.territory ?? "",
      status: l.status,
      owner: l.owner?.fullName ?? "",
    }));
    return toCsv(rows, LEAD_COLUMNS);
  }

  async exportOpportunitiesCsv(actor: AuthenticatedEmployee): Promise<string> {
    this.requireManager(actor);
    const opportunities = await this.opportunitiesService.list(actor, {});
    const rows = opportunities.map((o) => ({
      title: o.title,
      company: o.company ?? "",
      amountMinor: o.amountMinor,
      currency: o.currency,
      stage: o.stage?.name ?? "",
      status: o.status,
      forecastCategory: o.forecastCategory,
      owner: o.owner?.fullName ?? "",
      expectedCloseDate: o.expectedCloseDate ? o.expectedCloseDate.toISOString() : "",
    }));
    return toCsv(rows, OPPORTUNITY_COLUMNS);
  }

  /**
   * Header-mapped CSV import for opportunities: title/name, company,
   * amountMinor (or amount, in major currency units), expectedCloseDate.
   * Always lands in the org's default pipeline's first stage, same as a
   * manually created opportunity with no pipelineId/stageId given.
   */
  async importOpportunitiesCsv(actor: AuthenticatedEmployee, fileContent: string) {
    this.requireManager(actor);

    let records: Record<string, string>[];
    try {
      records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });
    } catch (err) {
      throw new BadRequestException(`Malformed CSV: ${(err as Error).message}`);
    }

    const created: unknown[] = [];
    const errors: RowError[] = [];
    const detectedHeaders = records.length > 0 ? Object.keys(records[0]) : [];

    for (let i = 0; i < records.length; i++) {
      const raw = records[i];
      const title = pickField(raw, ["title", "name"]);

      if (!title) {
        errors.push({
          row: i + 2,
          message: `Missing required field: title/name (detected columns: ${detectedHeaders.join(", ") || "none"})`,
        });
        continue;
      }

      const amountText = pickField(raw, ["amountMinor", "amount_minor"]);
      const amountMajorText = pickField(raw, ["amount"]);
      let amountMinor: number | undefined;
      if (amountText) {
        amountMinor = parseInt(amountText, 10);
      } else if (amountMajorText) {
        amountMinor = Math.round(parseFloat(amountMajorText) * 100);
      }
      if (amountMinor !== undefined && Number.isNaN(amountMinor)) {
        errors.push({ row: i + 2, message: `Invalid amount "${amountMajorText ?? amountText}"` });
        continue;
      }

      try {
        const opportunity = await this.opportunitiesService.create(actor, {
          title,
          company: pickField(raw, ["company"]),
          amountMinor,
          expectedCloseDate: pickField(raw, ["expectedCloseDate", "expected_close_date"]),
        });
        created.push(opportunity);
      } catch (err) {
        errors.push({ row: i + 2, message: (err as Error).message });
      }
    }

    return { createdCount: created.length, errorCount: errors.length, created, errors, detectedHeaders };
  }

  /** Header-mapped CSV import for leads: full_name/name, email, phone, company, source. */
  async importLeadsCsv(actor: AuthenticatedEmployee, fileContent: string) {
    this.requireManager(actor);

    let records: Record<string, string>[];
    try {
      records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });
    } catch (err) {
      throw new BadRequestException(`Malformed CSV: ${(err as Error).message}`);
    }

    const created: unknown[] = [];
    const errors: RowError[] = [];
    const detectedHeaders = records.length > 0 ? Object.keys(records[0]) : [];

    for (let i = 0; i < records.length; i++) {
      const raw = records[i];
      const fullName = pickField(raw, ["full_name", "fullName", "name", "full name"]);

      if (!fullName) {
        errors.push({
          row: i + 2,
          message: `Missing required field: full_name/name (detected columns: ${detectedHeaders.join(", ") || "none"})`,
        });
        continue;
      }

      try {
        const lead = await this.leadsService.create(actor, {
          fullName,
          email: pickField(raw, ["email", "email address"]),
          phone: pickField(raw, ["phone", "phone number", "mobile"]),
          company: pickField(raw, ["company"]),
          source: pickField(raw, ["source"]) ?? "CSV import",
          territory: pickField(raw, ["territory", "region"]),
        });
        created.push(lead);
      } catch (err) {
        errors.push({ row: i + 2, message: (err as Error).message });
      }
    }

    return { createdCount: created.length, errorCount: errors.length, created, errors, detectedHeaders };
  }

  /** Header-mapped CSV import for employees: full_name/name, email, role, department. */
  async importEmployeesCsv(actor: AuthenticatedEmployee, fileContent: string) {
    this.requireManager(actor);

    let records: Record<string, string>[];
    try {
      records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });
    } catch (err) {
      throw new BadRequestException(`Malformed CSV: ${(err as Error).message}`);
    }

    return this.importRows(actor, records);
  }

  private async importRows(actor: AuthenticatedEmployee, records: Record<string, string>[]) {
    const created: unknown[] = [];
    const errors: RowError[] = [];
    const detectedHeaders = records.length > 0 ? Object.keys(records[0]) : [];

    for (let i = 0; i < records.length; i++) {
      const raw = records[i];
      const fullName = pickField(raw, ["full_name", "fullName", "name", "full name"]);
      const email = pickField(raw, ["email", "email address"]);
      const roleField = pickField(raw, ["role"]);
      const roleRaw = (roleField ?? "EMPLOYEE").toUpperCase();

      if (!fullName || !email) {
        errors.push({
          row: i + 2,
          message: `Missing required field: full_name/name or email (detected columns: ${detectedHeaders.join(", ") || "none"})`,
        });
        continue;
      }
      if (!Object.values(Role).includes(roleRaw as Role)) {
        errors.push({ row: i + 2, message: `Unrecognized role "${roleField}"` });
        continue;
      }

      try {
        const result = await this.employeesService.create(actor, {
          fullName,
          email,
          role: roleRaw as Role,
          department: pickField(raw, ["department"]),
        });
        created.push(result);
      } catch (err) {
        errors.push({ row: i + 2, message: (err as Error).message });
      }
    }

    return { createdCount: created.length, errorCount: errors.length, created, errors, detectedHeaders };
  }

  async exportToGoogleSheets(actor: AuthenticatedEmployee, dto: GoogleSheetsSyncDto) {
    this.requireManager(actor);

    if (dto.object === "employees") {
      const employees = await this.employeesService.list(actor);
      const rows = [
        EMPLOYEE_COLUMNS,
        ...employees.map((e) => EMPLOYEE_COLUMNS.map((col) => String((e as Record<string, unknown>)[col] ?? ""))),
      ];
      await this.googleSheets.writeRange(dto.spreadsheetId, dto.range, rows);
    } else {
      const assignments = await this.assignmentsService.list(actor, {});
      const rows = [
        ASSIGNMENT_COLUMNS,
        ...assignments.map((a) => [
          String(a.assignmentNumber),
          a.title,
          a.status,
          a.priority,
          a.owner?.fullName ?? "",
          a.dueAt ? a.dueAt.toISOString() : "",
        ]),
      ];
      await this.googleSheets.writeRange(dto.spreadsheetId, dto.range, rows);
    }

    await this.prisma.auditEvent.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: "export.google_sheets",
        targetType: dto.object,
        metadata: { spreadsheetId: dto.spreadsheetId, range: dto.range },
      },
    });

    return { ok: true };
  }

  async importFromGoogleSheets(actor: AuthenticatedEmployee, dto: GoogleSheetsSyncDto) {
    this.requireManager(actor);

    const rows = await this.googleSheets.readRange(dto.spreadsheetId, dto.range);
    if (rows.length < 2) {
      return { createdCount: 0, errorCount: 0, created: [], errors: [] };
    }

    const [header, ...body] = rows;
    const normalizedHeader = header.map((h) => h.trim().toLowerCase());
    const records = body.map((row) =>
      Object.fromEntries(normalizedHeader.map((key, i) => [key, row[i] ?? ""])),
    );

    const result = await this.importRows(actor, records);

    // Audit metadata intentionally omits `result.created` — those objects carry
    // each new employee's one-time plaintext temporary password, which must
    // never be persisted to the audit log.
    await this.prisma.auditEvent.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: "import.google_sheets",
        targetType: "employees",
        metadata: {
          spreadsheetId: dto.spreadsheetId,
          range: dto.range,
          createdCount: result.createdCount,
          errorCount: result.errorCount,
          errors: result.errors as unknown as Prisma.InputJsonValue,
        },
      },
    });

    return result;
  }

  googleSheetsStatus() {
    return { configured: this.googleSheets.isConfigured() };
  }
}
