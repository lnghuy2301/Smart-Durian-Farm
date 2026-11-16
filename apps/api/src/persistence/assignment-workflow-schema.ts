// Pending Assign intervals được serialize dưới khóa Zone/Farm trong adapter;
// business intervals còn có exclusion constraint001. End chỉ một slot Pending.
export const ASSIGNMENT_WORKFLOW_SCHEMA = `
CREATE UNIQUE INDEX assignment_one_pending_end ON technical.workflow_requests(lower(target_key))
WHERE module='assignments' AND action='End' AND status='Pending' AND target_key IS NOT NULL;
`;
