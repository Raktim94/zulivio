export type Role = "MASTER_OWNER" | "COMPANY_ADMIN" | "SALES_HEAD" | "MANAGER" | "EMPLOYEE";

export type EmploymentStatus = "ACTIVE" | "SUSPENDED" | "ON_LEAVE" | "SEPARATED";

export type AssignmentStatus =
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "FOLLOW_UP"
  | "BLOCKED"
  | "COMPLETED"
  | "CANCELED";

export type AttendanceState = "logged_out" | "working" | "on_break";

export type BackupStatus = "PENDING" | "UPLOADING" | "VERIFIED" | "FAILED";

export interface BackupRecord {
  id: string;
  status: BackupStatus;
  dbKey: string | null;
  uploadsKey: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface AuditEventSummary {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; fullName: string; employeeNumber: string } | null;
}

export interface BackupStatusData {
  configured: boolean;
  source: "database" | "environment" | null;
  endpoint: string | null;
  bucket: string | null;
  region: string | null;
  accessKeyIdMasked: string | null;
  intervalDays: number;
  retainCount: number;
  lastBackup: BackupRecord | null;
  nextScheduledAt: string | null;
}

export interface GoogleSheetsStatusData {
  configured: boolean;
  source: "database" | "environment" | null;
  clientEmail: string | null;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  lastFour: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyCreated {
  id: string;
  name: string;
  /** Only ever present in the create response — shown once, never retrievable again. */
  token: string;
  lastFour: string;
  createdAt: string;
}

export interface EmployeeSummary {
  id: string;
  employeeNumber: string;
  fullName: string;
  email: string;
  role: Role;
  department: string | null;
  employmentStatus: EmploymentStatus;
  managerId: string | null;
  createdAt: string;
}

export interface CurrentEmployee {
  id: string;
  organizationId: string;
  role: Role;
  fullName: string;
  email: string;
  employmentStatus: EmploymentStatus;
}

export interface AssignmentSummary {
  id: string;
  assignmentNumber: number;
  title: string;
  description: string | null;
  status: AssignmentStatus;
  priority: string;
  ownerId: string | null;
  owner: { id: string; fullName: string; employeeNumber: string } | null;
  dueAt: string | null;
  createdAt: string;
}

export interface WorkSessionStatus {
  state: AttendanceState;
  sessionId?: string;
  startedAt?: string;
  currentBreakId?: string;
}

export interface DashboardData {
  generatedAt: string;
  headcount: { total: number; active: number };
  assignments: { byStatus: Record<string, number>; overdue: number };
  liveAttendance: {
    employeeId: string;
    employeeName: string;
    employeeNumber: string;
    state: "working" | "on_break";
    startedAt: string;
  }[];
  workingNow: number;
  onBreakNow: number;
  knowledge: { documentsPublished: number; tipsPublished: number };
}

export interface TipFeedItem {
  id: string;
  title: string;
  body: string;
  publishAt: string;
  acknowledged: boolean;
}

export interface TrainingFeedItem {
  id: string;
  document: { id: string; title: string; version: number };
  dueAt: string | null;
  acknowledgedAt: string | null;
}

export interface EmployeeTotalReport {
  attendance: {
    employeeId: string;
    employeeNumber: string;
    totalNetWorkedMinutes: number;
    totalBreakMinutes: number;
    sessionCount: number;
    sessions: {
      id: string;
      startedAt: string;
      endedAt: string | null;
      netWorkedMinutes: number;
      breakMinutes: number;
      breakCount: number;
      stillOpen: boolean;
    }[];
  };
  assignments: {
    total: number;
    completed: number;
    followUp: number;
    blocked: number;
    inProgress: number;
    canceled: number;
  };
  trainingAcknowledged: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string | string[]; correlationId: string };
}

export type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "DISQUALIFIED" | "CONVERTED";

export interface LeadSummary {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  status: LeadStatus;
  notes: string | null;
  territory: string | null;
  ownerId: string | null;
  owner: { id: string; fullName: string; employeeNumber: string } | null;
  respondBySlaAt: string | null;
  firstRespondedAt: string | null;
  convertedOpportunityId: string | null;
  createdAt: string;
}

export type OpportunityStatus = "OPEN" | "WON" | "LOST";
export type ForecastCategory = "PIPELINE" | "BEST_CASE" | "COMMITTED" | "OMITTED";

export interface PipelineStageSummary {
  id: string;
  name: string;
  sortOrder: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

export interface PipelineSummary {
  id: string;
  name: string;
  isDefault: boolean;
  stages: PipelineStageSummary[];
}

export interface OpportunitySummary {
  id: string;
  pipelineId: string;
  stageId: string;
  stage: PipelineStageSummary;
  title: string;
  company: string | null;
  amountMinor: number;
  currency: string;
  status: OpportunityStatus;
  forecastCategory: ForecastCategory;
  lossReason: string | null;
  ownerId: string | null;
  owner: { id: string; fullName: string; employeeNumber: string } | null;
  expectedCloseDate: string | null;
  createdAt: string;
}

export type AssignmentRuleMode = "ROUND_ROBIN" | "TERRITORY" | "CAPACITY";

export interface AssignmentRuleSummary {
  id: string;
  name: string;
  isActive: boolean;
  mode: AssignmentRuleMode;
  slaMinutes: number;
  memberIds: string[];
  territoryMap: Record<string, string> | null;
  maxOpenLeads: number | null;
}

export type QualityAuditStatus = "DRAFT" | "PUBLISHED";

export interface QualityAuditDefinitionSummary {
  id: string;
  name: string;
  description: string | null;
  sections: unknown;
  isActive: boolean;
  createdAt: string;
}

export interface QualityAuditResultSummary {
  id: string;
  definitionId: string;
  definition: { id: string; name: string };
  employeeId: string;
  employee?: { id: string; fullName: string; employeeNumber: string };
  reviewerId: string;
  reviewer: { id: string; fullName: string };
  referenceType: string | null;
  referenceId: string | null;
  overallScore: number;
  sectionScores: unknown;
  feedback: string | null;
  status: QualityAuditStatus;
  acknowledgedAt: string | null;
  createdAt: string;
}

export type WorkflowStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type WorkflowRunStatus = "IN_PROGRESS" | "COMPLETED";

export interface WorkflowDefinitionSummary {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  version: number;
  status: WorkflowStatus;
  steps: { id: string; title: string; body?: string; fields?: unknown[] }[];
  createdAt: string;
}

export interface WorkflowRunSummary {
  id: string;
  workflowDefinitionId: string;
  workflowDefinition?: { id: string; name: string; tags: string[] };
  currentStepIndex: number;
  answers: Record<string, unknown>;
  status: WorkflowRunStatus;
  startedAt: string;
  completedAt: string | null;
}

export interface MeHomeData {
  attendance: WorkSessionStatus;
  summary: { assigned: number; inProgress: number; followUp: number; completedToday: number };
  activeWork: AssignmentSummary[];
}

export interface MeTasksData {
  pending: AssignmentSummary[];
  completed: AssignmentSummary[];
  all: AssignmentSummary[];
  workflowRuns: WorkflowRunSummary[];
}

export interface AgentAssistResult {
  lead: {
    id: string;
    fullName: string;
    status: LeadStatus;
    ownerId: string | null;
    territory: string | null;
    source: string | null;
    nextAllowedStatuses: LeadStatus[];
  } | null;
  knowledgeDocuments: { id: string; title: string; category: string | null; status: string }[];
  tips: TipFeedItem[];
}

export interface SalesHeadDirectoryEntry {
  id: string;
  employeeNumber: string;
  fullName: string;
  role: Role;
  department: string | null;
  employmentStatus: EmploymentStatus;
  openAssignments: number;
  overdueAssignments: number;
  openLeads: number;
  openOpportunities: number;
  openPipelineValueMinor: number;
}

export interface SalesHeadEmployeeDetail {
  employee: EmployeeSummary;
  attendance: WorkSessionStatus;
  assignments: AssignmentSummary[];
  leads: LeadSummary[];
  opportunities: OpportunitySummary[];
  qualityResults: QualityAuditResultSummary[];
  recentAudit: AuditEventSummary[];
}

export interface SalesDashboardData {
  generatedAt: string;
  pipelineValue: { totalMinor: number; weightedForecastMinor: number };
  stageBreakdown: {
    stageId: string;
    stageName: string;
    count: number;
    valueMinor: number;
    opportunityIds: string[];
  }[];
  forecastByCategory: Record<string, number>;
  byOwner: {
    ownerId: string;
    ownerName: string;
    valueMinor: number;
    weightedForecastMinor: number;
    count: number;
    forecastByCategory: Record<string, number>;
    opportunityIds: string[];
  }[];
  leadFunnel: Record<string, number>;
  overdueLeads: number;
  winLoss: { won: number; lost: number };
  dailyTrend: { date: string; won: number; lost: number; newLeads: number }[];
}
