import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { parse } from "csv-parse/sync";
import { Prisma, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { isManagerOrAbove } from "../common/roles";
import { EmployeesService } from "../employees/employees.service";
import { AssignmentsService } from "../assignments/assignments.service";
import { LeadsService } from "../leads/leads.service";
import { OpportunitiesService } from "../opportunities/opportunities.service";
import { GoogleSheetsService } from "./google-sheets.service";
import { sanitizeCsvCell, toCsv } from "./csv.util";
import { GoogleSheetsSyncDto } from "./dto/google-sheets-sync.dto";
import { SetGoogleSheetsConfigDto } from "./dto/set-google-sheets-config.dto";

const EMPLOYEE_COLUMNS = ["employeeNumber", "fullName", "email", "role", "department", "employmentStatus"];
const ASSIGNMENT_COLUMNS = ["assignmentNumber", "title", "status", "priority", "owner", "dueAt"];
const LEAD_COLUMNS = ["fullName", "email", "phone", "company", "source", "territory", "status", "owner"];

/**
 * Every CSV header a lead import recognizes as a real Lead column. Anything
 * else in the file (rating/category/city/outreach_angle/...) still gets
 * imported — see extractCustomFields — it just lands in `customFields`
 * instead of a dedicated column, so any CSV shape is importable without a
 * schema change.
 */
const LEAD_FIELD_ALIASES: Record<string, string[]> = {
  fullName: ["full_name", "fullName", "name", "full name", "contact_name", "contact name"],
  email: ["email", "email address"],
  phone: ["phone", "phone number", "mobile", "phone_local_10d", "phone local 10d", "contact_phone"],
  company: ["company", "company_name", "company name", "business_name", "business name"],
  source: ["source"],
  territory: ["territory", "region"],
  website: ["website", "url", "site"],
  jobTitle: ["job_title", "jobtitle", "title", "job title"],
  campaign: ["campaign"],
};

const CLAIMED_LEAD_HEADER_KEYS = new Set(
  Object.values(LEAD_FIELD_ALIASES)
    .flat()
    .map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, "")),
);

/** "Phone Local 10d" -> "phone_local_10d" — a stable, display-friendly key for an unrecognized CSV column. */
function toCustomFieldKey(header: string): string {
  const key = header
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return key || header.trim();
}

/** Every column of a CSV row that importLeadsCsv doesn't map to a real Lead field, keyed for display. */
function extractCustomFields(raw: Record<string, string>): Record<string, string> {
  const custom: Record<string, string> = {};
  for (const [header, value] of Object.entries(raw)) {
    if (CLAIMED_LEAD_HEADER_KEYS.has(normalizeKey(header))) continue;
    const trimmed = value?.trim();
    if (!trimmed) continue;
    custom[toCustomFieldKey(header)] = trimmed;
  }
  return custom;
}
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

const SCIENTIFIC_NOTATION = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;

/**
 * Scraped-lead exports commonly carry both a `phone` column already
 * destroyed by Excel/Sheets ("9.18E+11") *and* a same-row fallback like
 * `phone_local_10d` with the real digits, specifically because the source
 * tool already worked around the same mangling once. Plain `pickField`
 * would always take `phone` since it's first in the alias list and
 * non-empty, silently preferring the broken value over the good one sitting
 * right next to it. Skip any candidate still in scientific notation and
 * keep looking for a clean one before falling back to it.
 */
function pickPhoneField(raw: Record<string, string>, aliases: string[]): string | undefined {
  const normalized = new Map(Object.entries(raw).map(([k, v]) => [normalizeKey(k), v]));
  let mangledFallback: string | undefined;
  for (const alias of aliases) {
    const value = normalized.get(normalizeKey(alias))?.trim();
    if (!value) continue;
    if (SCIENTIFIC_NOTATION.test(value)) {
      mangledFallback ??= value;
      continue;
    }
    return value;
  }
  return mangledFallback;
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
    if (!isManagerOrAbove(actor.role)) {
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
    return toCsv(rows, LEAD_COLUMNS, ["phone"]);
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
      records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
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

      const expectedCloseDateText = pickField(raw, ["expectedCloseDate", "expected_close_date"]);
      if (expectedCloseDateText && Number.isNaN(new Date(expectedCloseDateText).getTime())) {
        errors.push({ row: i + 2, message: `Invalid expectedCloseDate "${expectedCloseDateText}"` });
        continue;
      }

      try {
        const opportunity = await this.opportunitiesService.create(actor, {
          title,
          company: pickField(raw, ["company"]),
          amountMinor,
          expectedCloseDate: expectedCloseDateText,
        });
        created.push(opportunity);
      } catch (err) {
        errors.push({ row: i + 2, message: (err as Error).message });
      }
    }

    return { createdCount: created.length, errorCount: errors.length, created, errors, detectedHeaders };
  }

  /**
   * Header-mapped CSV import for leads. Recognizes full_name/email/phone/
   * company/source/territory/website/job_title/campaign under several
   * common header spellings (see LEAD_FIELD_ALIASES) and maps them to real
   * Lead columns; every other column in the file — rating, category, city,
   * outreach_angle, or anything else a scraped-lead export happens to carry
   * — is preserved in `customFields` instead of being dropped, so any CSV
   * shape can be imported without a schema change.
   */
  async importLeadsCsv(actor: AuthenticatedEmployee, fileContent: string) {
    this.requireManager(actor);

    let records: Record<string, string>[];
    try {
      records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
    } catch (err) {
      throw new BadRequestException(`Malformed CSV: ${(err as Error).message}`);
    }

    const created: unknown[] = [];
    const errors: RowError[] = [];
    const detectedHeaders = records.length > 0 ? Object.keys(records[0]) : [];

    for (let i = 0; i < records.length; i++) {
      const raw = records[i];
      const company = pickField(raw, LEAD_FIELD_ALIASES.company);
      // Scraped/B2B lead exports often carry only a business name with no named contact
      // (e.g. lead-scoring tools with company/rating/source_urls columns but no full_name
      // value) — fall back to the company name as the lead's identity rather than rejecting
      // the row, since `Lead.fullName` is a required column with nothing else to put there.
      const fullName = pickField(raw, LEAD_FIELD_ALIASES.fullName) ?? company;

      if (!fullName) {
        errors.push({
          row: i + 2,
          message: `Missing required field: full_name/name (or company) (detected columns: ${detectedHeaders.join(", ") || "none"})`,
        });
        continue;
      }

      try {
        const lead = await this.leadsService.create(actor, {
          fullName,
          email: pickField(raw, LEAD_FIELD_ALIASES.email),
          phone: pickPhoneField(raw, LEAD_FIELD_ALIASES.phone),
          company,
          source: pickField(raw, LEAD_FIELD_ALIASES.source) ?? "CSV import",
          territory: pickField(raw, LEAD_FIELD_ALIASES.territory),
          website: pickField(raw, LEAD_FIELD_ALIASES.website),
          jobTitle: pickField(raw, LEAD_FIELD_ALIASES.jobTitle),
          campaign: pickField(raw, LEAD_FIELD_ALIASES.campaign),
          customFields: extractCustomFields(raw),
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
      records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
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
        ...employees.map((e) => EMPLOYEE_COLUMNS.map((col) => sanitizeCsvCell((e as Record<string, unknown>)[col]))),
      ];
      await this.googleSheets.writeRange(dto.spreadsheetId, dto.range, rows);
    } else {
      const assignments = await this.assignmentsService.list(actor, {});
      const rows = [
        ASSIGNMENT_COLUMNS,
        ...assignments.map((a) =>
          [a.assignmentNumber, a.title, a.status, a.priority, a.owner?.fullName ?? "", a.dueAt ?? ""].map((value) =>
            sanitizeCsvCell(value),
          ),
        ),
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
    return this.googleSheets.status();
  }

  setGoogleSheetsConfig(actor: AuthenticatedEmployee, dto: SetGoogleSheetsConfigDto) {
    return this.googleSheets.setConfig(actor, dto);
  }

  clearGoogleSheetsConfig(actor: AuthenticatedEmployee) {
    return this.googleSheets.clearConfig(actor);
  }
}
