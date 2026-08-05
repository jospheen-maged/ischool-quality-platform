import type { PermissionKey } from './lib/permissions';

export type UserRole = 'super_admin' | 'admin' | 'qtl' | 'qc' | 'tutor';

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  role: UserRole;
  tutor_id: string | null;
  is_active: boolean;
  permissions: Partial<Record<PermissionKey, boolean>>;
};

export type ComplianceResult =
  | 'clear'
  | 'coaching_note'
  | 'yellow_flag'
  | 'red_flag'
  | 'external_cause'
  | 'not_applicable';

export type EvaluationCriterion = {
  id: string;
  section_id: string;
  code: string;
  title: string;
  description: string | null;
  max_score: number;
  weight_percentage: number;
  anchor_1: string | null;
  anchor_3: string | null;
  anchor_5: string | null;
  sort_order: number;
  criterion_type: 'rating' | 'compliance';
};

export type ReviewSummary = {
  id: string;
  tutor_id: string;
  evaluator_id: string;
  session_date: string;
  session_topic: string | null;
  status: string;
  total_score: number | null;
  maximum_score: number | null;
  score_percentage: number | null;
  compliance_status: string;
  published_at: string | null;
  created_at: string;
};
