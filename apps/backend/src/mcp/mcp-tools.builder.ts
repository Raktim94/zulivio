import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AssignmentStatus, LeadStatus } from "@prisma/client";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { EmployeesService } from "../employees/employees.service";
import { LeadsService } from "../leads/leads.service";
import { AttendanceService } from "../attendance/attendance.service";
import { AssignmentsService } from "../assignments/assignments.service";
import { ReportsService } from "../reports/reports.service";

const ASSIGNMENT_STATUS_VALUES = ["ASSIGNED", "IN_PROGRESS", "FOLLOW_UP", "BLOCKED", "COMPLETED", "CANCELED"] as const;
const LEAD_STATUS_VALUES = ["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isAssignmentStatus(value: string): value is AssignmentStatus {
  return (ASSIGNMENT_STATUS_VALUES as readonly string[]).includes(value);
}

function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUS_VALUES as readonly string[]).includes(value);
}

/** Reads and type-checks arguments.tools/call sends as plain `Record<string, unknown>` — see the class doc comment for why this isn't zod-typed. */
class Args {
  constructor(private readonly raw: Record<string, unknown>) {}

  string(key: string): string {
    const value = this.raw[key];
    if (typeof value !== "string" || value.length === 0) throw new Error(`"${key}" is required and must be a string`);
    return value;
  }

  optionalString(key: string): string | undefined {
    const value = this.raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new Error(`"${key}" must be a string`);
    return value;
  }

  optionalEmail(key: string): string | undefined {
    const value = this.optionalString(key);
    if (value !== undefined && !EMAIL_RE.test(value)) throw new Error(`"${key}" must be a valid email address`);
    return value;
  }

  optionalBoolean(key: string): boolean | undefined {
    const value = this.raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") throw new Error(`"${key}" must be a boolean`);
    return value;
  }
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  readOnly: boolean;
  handler: (args: Args) => Promise<CallToolResult>;
}

/**
 * Builds a fresh McpServer bound to one authenticated employee. Every tool
 * here calls straight into the same service methods the REST API uses
 * (EmployeesService, LeadsService, etc.) with that employee as `actor` —
 * so every existing role/RBAC/scope check (rank gates, subtree scoping,
 * ownership checks) applies exactly as it would for a real logged-in user.
 * This is a deliberately curated subset of the API, not a 1:1 mirror:
 * nothing destructive (no delete-employee, no role changes, no backup
 * restore, no bulk operations) is reachable through MCP. See README.md's
 * "MCP server" section for the full tool list and rationale.
 *
 * Wired via the SDK's low-level `server.setRequestHandler(ListTools/
 * CallToolRequestSchema, ...)` and plain JSON Schema — not the convenience
 * `registerTool(name, { inputSchema: <zod raw shape> }, handler)` API —
 * deliberately. registerTool's generics, resolved against zod schemas,
 * reliably triggered `nest build`'s TypeScript compiler (not plain `tsc
 * --noEmit`, which never reproduced it) into "Type instantiation is
 * excessively deep" (TS2589). This wasn't isolated to specific tools: the
 * same handful of tool definitions moved between which ones failed across
 * several fix attempts (enum vs plain string inputs, inline vs
 * separately-typed callbacks, one file vs split across two, one method vs
 * many) without the total failure count changing — evidence of a
 * compiler-wide instantiation budget being exhausted somewhere in the
 * zod/registerTool generic chain, not a problem with any one tool's
 * shape. The low-level API sidesteps it entirely: ListToolsRequestSchema/
 * CallToolRequestSchema are the SDK's own pre-built, already-compiled zod
 * schemas (not schemas this file constructs), and tool argument
 * validation here is a handful of plain runtime type checks (see the Args
 * class above) rather than zod parsing — no fresh generic inference for
 * this file to trigger the same class of issue with. If tools are added
 * later and `pnpm build` (not just `pnpm typecheck`) starts failing with
 * TS2589 again, this reasoning is the first thing to revisit.
 */
@Injectable()
export class McpToolsBuilder {
  constructor(
    private readonly employees: EmployeesService,
    private readonly leads: LeadsService,
    private readonly attendance: AttendanceService,
    private readonly assignments: AssignmentsService,
    private readonly reports: ReportsService,
  ) {}

  build(actor: AuthenticatedEmployee): McpServer {
    const server = new McpServer({ name: "zulivio", version: "1.0.0" }, { capabilities: { tools: {} } });
    const tools = this.toolDefs(actor);

    server.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: tools.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: { readOnlyHint: t.readOnly },
      })),
    }));

    server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = tools.find((t) => t.name === request.params.name);
      if (!tool) return errorResult(new Error(`Unknown tool "${request.params.name}"`));
      try {
        return await tool.handler(new Args(request.params.arguments ?? {}));
      } catch (err) {
        return errorResult(err);
      }
    });

    return server;
  }

  private toolDefs(actor: AuthenticatedEmployee): ToolDef[] {
    return [
      {
        name: "list_employees",
        title: "List employees",
        description: "List employees in the caller's organization, scoped by the caller's role (same visibility as the Employees page).",
        inputSchema: { type: "object" },
        readOnly: true,
        handler: async () => json(await this.employees.list(actor)),
      },
      {
        name: "my_attendance_status",
        title: "My attendance status",
        description: "Get the caller's current attendance state: logged_out, working, or on_break.",
        inputSchema: { type: "object" },
        readOnly: true,
        handler: async () => json(await this.attendance.currentStatus(actor)),
      },
      {
        name: "start_attendance",
        title: "Start attendance",
        description: "Start the caller's work session (clock in). Fails if one is already open.",
        inputSchema: { type: "object" },
        readOnly: false,
        handler: async () => json(await this.attendance.start(actor)),
      },
      {
        name: "end_attendance",
        title: "End attendance",
        description: "End the caller's currently open work session (clock out). Fails if none is open.",
        inputSchema: { type: "object" },
        readOnly: false,
        handler: async () => {
          const status = await this.attendance.currentStatus(actor);
          if (status.state === "logged_out" || !status.sessionId) {
            throw new Error("No open work session to end.");
          }
          return json(await this.attendance.endSession(actor, status.sessionId));
        },
      },
      {
        name: "list_my_tasks",
        title: "List my tasks",
        description: `List assignments owned by the caller, optionally filtered by status: one of ${ASSIGNMENT_STATUS_VALUES.join(", ")}.`,
        inputSchema: {
          type: "object",
          properties: { status: { type: "string", enum: ASSIGNMENT_STATUS_VALUES } },
        },
        readOnly: true,
        handler: async (args) => {
          const status = args.optionalString("status");
          if (status !== undefined && !isAssignmentStatus(status)) {
            throw new Error(`Invalid status "${status}". Must be one of: ${ASSIGNMENT_STATUS_VALUES.join(", ")}`);
          }
          return json(await this.assignments.list(actor, { ownerId: actor.id, status }));
        },
      },
      {
        name: "update_task_status",
        title: "Update task status",
        description: `Transition an assignment to a new status: one of ${ASSIGNMENT_STATUS_VALUES.join(", ")}. Only the assignment's owner, its creator, or a Manager+ may do this, and only along allowed transitions — same rules as the app.`,
        inputSchema: {
          type: "object",
          properties: {
            assignmentId: { type: "string", description: "Assignment id" },
            toStatus: { type: "string", enum: ASSIGNMENT_STATUS_VALUES },
            reason: { type: "string", description: "Optional note explaining the change" },
          },
          required: ["assignmentId", "toStatus"],
        },
        readOnly: false,
        handler: async (args) => {
          const assignmentId = args.string("assignmentId");
          const toStatus = args.string("toStatus");
          const reason = args.optionalString("reason");
          if (!isAssignmentStatus(toStatus)) {
            throw new Error(`Invalid toStatus "${toStatus}". Must be one of: ${ASSIGNMENT_STATUS_VALUES.join(", ")}`);
          }
          return json(await this.assignments.transition(actor, assignmentId, toStatus, reason));
        },
      },
      {
        name: "list_leads",
        title: "List leads",
        description: `List leads visible to the caller (their own unless Manager+), optionally filtered by status (one of ${LEAD_STATUS_VALUES.join(", ")}) or overdue SLA.`,
        inputSchema: {
          type: "object",
          properties: {
            status: { type: "string", enum: LEAD_STATUS_VALUES },
            overdue: { type: "boolean", description: "Only leads past their first-response SLA with no response yet" },
          },
        },
        readOnly: true,
        handler: async (args) => {
          const status = args.optionalString("status");
          if (status !== undefined && !isLeadStatus(status)) {
            throw new Error(`Invalid status "${status}". Must be one of: ${LEAD_STATUS_VALUES.join(", ")}`);
          }
          return json(await this.leads.list(actor, { status, overdue: args.optionalBoolean("overdue") }));
        },
      },
      {
        name: "create_lead",
        title: "Create lead",
        description: "Create a new lead. Set autoAssign to true to run the org's active assignment rule instead of specifying an owner.",
        inputSchema: {
          type: "object",
          properties: {
            fullName: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            company: { type: "string" },
            source: { type: "string" },
            notes: { type: "string" },
            territory: { type: "string" },
            ownerId: { type: "string" },
            autoAssign: { type: "boolean" },
          },
          required: ["fullName"],
        },
        readOnly: false,
        handler: async (args) =>
          json(
            await this.leads.create(actor, {
              fullName: args.string("fullName"),
              email: args.optionalEmail("email"),
              phone: args.optionalString("phone"),
              company: args.optionalString("company"),
              source: args.optionalString("source"),
              notes: args.optionalString("notes"),
              territory: args.optionalString("territory"),
              ownerId: args.optionalString("ownerId"),
              autoAssign: args.optionalBoolean("autoAssign"),
            }),
          ),
      },
      {
        name: "sales_dashboard",
        title: "Sales dashboard",
        description: "Pipeline/won/lost stats and a 14-day trend, scoped to the caller's reporting subtree. Manager+ only, same as the app.",
        inputSchema: { type: "object" },
        readOnly: true,
        handler: async () => json(await this.reports.salesDashboard(actor)),
      },
    ];
  }
}
