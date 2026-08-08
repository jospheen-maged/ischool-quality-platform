import type { Profile, UserRole } from '../types';

export type PermissionKey =
  | 'view_dashboard'
  | 'create_evaluation'
  | 'view_reviews'
  | 'publish_reviews'
  | 'edit_reviews'
  | 'delete_reviews'
  | 'view_objections'
  | 'review_objections'
  | 'view_analytics'
  | 'manage_tutors'
  | 'manage_model_settings'
  | 'manage_people'
  | 'manage_access';

export type PermissionMap = Record<PermissionKey, boolean>;

const allPermissions: PermissionKey[] = [
  'view_dashboard',
  'create_evaluation',
  'view_reviews',
  'publish_reviews',
  'edit_reviews',
  'delete_reviews',
  'view_objections',
  'review_objections',
  'view_analytics',
  'manage_tutors',
  'manage_model_settings',
  'manage_people',
  'manage_access',
];

const noPermissions = Object.fromEntries(allPermissions.map((key) => [key, false])) as PermissionMap;

export const rolePermissionDefaults: Record<UserRole, PermissionMap> = {
  super_admin: Object.fromEntries(allPermissions.map((key) => [key, true])) as PermissionMap,
  admin: {
    ...noPermissions,
    view_dashboard: true,
    create_evaluation: true,
    view_reviews: true,
    publish_reviews: true,
    edit_reviews: true,
    view_objections: true,
    review_objections: true,
    view_analytics: true,
    manage_tutors: true,
    manage_model_settings: true,
    manage_people: true,
  },
  qtl: {
    ...noPermissions,
    view_dashboard: true,
    create_evaluation: true,
    view_reviews: true,
    publish_reviews: true,
    edit_reviews: true,
    view_objections: true,
    review_objections: true,
    view_analytics: true,
    manage_tutors: true,
    manage_model_settings: true,
  },
  qc: {
    ...noPermissions,
    view_dashboard: true,
    create_evaluation: true,
    view_reviews: true,
    publish_reviews: true,
    view_objections: true,
    review_objections: true,
  },
  tutor: {
    ...noPermissions,
    view_dashboard: true,
    view_reviews: true,
    view_objections: true,
  },
};

export const permissionGroups: Array<{
  title: string;
  description: string;
  permissions: Array<{ key: PermissionKey; label: string; description: string }>;
}> = [
  {
    title: 'Workspace tabs',
    description: 'Choose which navigation tabs are visible to this person.',
    permissions: [
      { key: 'view_dashboard', label: 'Dashboard', description: 'Open the workspace overview.' },
      { key: 'create_evaluation', label: 'New Evaluation', description: 'Open and submit evaluation forms.' },
      { key: 'view_reviews', label: 'Reviews', description: 'See review records allowed by the user role.' },
      { key: 'view_objections', label: 'Evaluation Re-consideration', description: 'See Evaluation Re-consideration cases allowed by the user role.' },
      { key: 'view_analytics', label: 'Analytics', description: 'Open analytics using records visible to the role.' },
      { key: 'manage_tutors', label: 'Tutors', description: 'Open the tutor directory and management tools.' },
      { key: 'manage_model_settings', label: 'Model Settings', description: 'Manage metrics, compliance items, weights, Organizations, and cycles.' },
      { key: 'manage_people', label: 'People & Access', description: 'Create accounts and update roles.' },
      { key: 'manage_access', label: 'Access Control', description: 'Change granular permissions for other people.' },
    ],
  },
  {
    title: 'Review actions',
    description: 'Control sensitive actions inside visible review records.',
    permissions: [
      { key: 'publish_reviews', label: 'Publish to Tutor', description: 'Publish eligible reviews. QC can publish only reviews they created.' },
      { key: 'edit_reviews', label: 'Edit Reviews', description: 'Edit review context, scores, Section 3, and feedback. QC can edit only reviews they created when enabled.' },
      { key: 'delete_reviews', label: 'Delete Reviews', description: 'Permanently delete a review and its linked evaluation data. QC can delete only reviews they created when enabled.' },
      { key: 'review_objections', label: 'Review Re-consideration Cases', description: 'Take decisions on Evaluation Re-consideration cases allowed by the role.' },
    ],
  },
];

export function getEffectivePermissions(profile: Profile | null | undefined): PermissionMap {
  if (!profile) return { ...noPermissions };
  if (profile.role === 'super_admin') return { ...rolePermissionDefaults.super_admin };
  const defaults = rolePermissionDefaults[profile.role];
  const overrides = profile.permissions ?? {};
  return { ...defaults, ...overrides };
}

export function hasPermission(profile: Profile | null | undefined, key: PermissionKey) {
  return getEffectivePermissions(profile)[key];
}
