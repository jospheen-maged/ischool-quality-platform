export type UserRole = 'super_admin' | 'admin' | 'qtl' | 'qc' | 'tutor';

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  role: UserRole;
  tutor_id: string | null;
  is_active: boolean;
};

export type EvaluationCriterion = {
  id: string;
  section_id: string;
  code: string;
  title: string;
  description: string | null;
  max_score: number;
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
  score_percentage: number | null;
  published_at: string | null;
  created_at: string;
};
