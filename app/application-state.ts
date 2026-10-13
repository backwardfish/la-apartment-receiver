export const PIPELINE_STAGES = ['Saved', 'Touring', 'Applied', 'Signed'] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];
export const DOCUMENT_ITEMS = [
  { id: 'id', label: 'Photo ID', detail: 'Prepare a current government-issued ID.' },
  { id: 'income', label: 'Income evidence', detail: 'Recent pay stubs, or self-employment records if applicable.' },
  { id: 'employment', label: 'Employment verification', detail: 'Employer contact or employment letter, if requested.' },
  { id: 'rental', label: 'Rental history & references', detail: 'Previous addresses, dates, and landlord contacts.' },
  { id: 'screening', label: 'Screening information', detail: 'Follow the manager’s screening process; consent and report requirements vary.' },
  { id: 'insurance', label: 'Renters insurance', detail: 'Check the lease requirements before arranging a policy.' },
] as const;
