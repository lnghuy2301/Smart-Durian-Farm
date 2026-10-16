export const HARVEST_WORKFLOW_SCHEMA = `
CREATE UNIQUE INDEX harvest_one_pending_request ON technical.workflow_requests(lower(target_key))
WHERE module='harvests' AND status='Pending' AND target_key IS NOT NULL;
CREATE INDEX harvest_backdate_lookup ON technical.workflow_requests(target_key,(payload->>'user_id'),(payload->>'harvest_date'))
WHERE module='harvest_backdates' AND status='Active';
`;
