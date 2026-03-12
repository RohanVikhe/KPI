export type Role = "ADMIN" | "MANAGER" | "EMPLOYEE";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  managerId?: string | null;
  isActive: boolean;
  skills?: string | null;
  projects?: Project[];
};

export type MetricType = "NUMBER" | "PERCENT" | "CURRENCY";

export type SubmissionStatus = "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "APPROVED" | "REJECTED";

export type ReviewStatus = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

export type Metric = {
  id: string;
  key: string;
  label: string;
  type: MetricType;
  isComputed?: boolean;
  definition?: string | null;
  formulaText?: string | null;
  calcFormula?: string | null;
  targetText?: string | null;
  frequency?: string | null;
  required: boolean;
  min?: number | null;
  max?: number | null;
  weight?: number | null;
  order?: number;
};

export type Goal = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  formula?: string | null;
  weight?: number | null;
  order?: number;
  metrics: Metric[];
};

export type GoalScore = {
  goalId: string;
  key: string;
  name: string;
  score: number | null;
  weight?: number | null;
};

export type Template = {
  id: string;
  name: string;
  description?: string | null;
  formula?: string | null;
  isActive: boolean;
  goals: Goal[];
};

export type SubmissionValue = {
  metricId: string;
  valueNumber: number;
  valueText?: string | null;
};

export type RawDeliveryData = {
  sheetName?: string | null;
  headers: string[];
  rows: string[][];
  links?: (string | null)[][];
};

export type Review = {
  id: string;
  status: ReviewStatus;
  comment?: string | null;
  reviewedAt: string;
  reviewerId: string;
  reviewer?: Pick<User, "id" | "name" | "role">;
};

export type Comment = {
  id: string;
  message: string;
  createdAt: string;
  author: Pick<User, "id" | "name" | "role">;
};

export type Project = {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  ticketCounts?: ProjectTicketCounts;
  createdAt?: string;
  updatedAt?: string;
};

export type ProjectTicketCounts = {
  total: number;
  done: number;
  overdue: number;
  changeRequests: number;
};

export type Submission = {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  status: SubmissionStatus;
  score?: number | null;
  submittedAt?: string;
  reviewedAt?: string | null;
  reviewerId?: string | null;
  template: Template;
  values: SubmissionValue[];
  goalScores?: GoalScore[];
  rawDeliveryData?: RawDeliveryData | null;
  goalNotes?: { goalId: string; note?: string | null; goal: Pick<Goal, "id" | "key" | "name"> }[];
  user?: Pick<User, "id" | "name" | "email" | "role"> & { projects?: Project[] };
  reviews?: Review[];
  comments?: Comment[];
};
