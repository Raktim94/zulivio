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

export interface SalesDashboardData {
  generatedAt: string;
  pipelineValue: { totalMinor: number; weightedForecastMinor: number };
  stageBreakdown: { stageId: string; stageName: string; count: number; valueMinor: number }[];
  forecastByCategory: Record<string, number>;
  byOwner: {
    ownerId: string;
    ownerName: string;
    valueMinor: number;
    weightedForecastMinor: number;
    count: number;
    forecastByCategory: Record<string, number>;
  }[];
  leadFunnel: Record<string, number>;
  overdueLeads: number;
  winLoss: { won: number; lost: number };
}
