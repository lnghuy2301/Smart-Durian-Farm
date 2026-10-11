import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRecord } from '../auth/user-accounts';
import { FarmApproval, FarmChangeRequest } from './farms.types';

export type FarmActor = Pick<UserRecord, 'id' | 'role' | 'status'>;

export function farmApprovals(role: 'Admin' | 'Farmer', owner: string, manager?: string): FarmApproval[] {
  const approvals: FarmApproval[] = [{ role: role === 'Admin' ? 'Farmer' : 'Admin', user_id: role === 'Admin' ? owner : null,
    approved_by: null, approved_at: null }];
  if (manager) { approvals.push({ role: 'Manager', user_id: manager, approved_by: null, approved_at: null }); }
  return approvals;
}

// Cùng quy tắc cho memory và PG; currentManager phải là dữ liệu hiện tại,
// không lấy từ snapshot/request để cho Manager cũ quyết định.
export function farmReviewerIndex(actor: FarmActor, request: FarmChangeRequest, currentManager: string | null): number {
  if (request.status !== 'Pending') { throw new ConflictException('Yêu cầu đã được xử lý'); }
  if (actor.id === request.proposed_by) { throw new ForbiddenException('Không được tự duyệt hoặc tự từ chối yêu cầu của mình'); }
  const index = request.required_approvals.findIndex((approval) => approval.role === actor.role
    && (!approval.user_id || approval.user_id === actor.id));
  if (index < 0) { throw new ForbiddenException('Bạn không thuộc bên cần duyệt yêu cầu này'); }
  if (actor.role === 'Manager' && currentManager !== actor.id) { throw new ForbiddenException('Bạn không còn quản lý HTX này'); }
  if (request.required_approvals[index].approved_by) { throw new ConflictException('Bên của bạn đã duyệt yêu cầu'); }
  return index;
}

export function assertFarmApprovers(request: FarmChangeRequest, users: ReadonlyMap<string, FarmActor>): void {
  for (const approval of request.required_approvals) {
    const reviewer = approval.approved_by ? users.get(approval.approved_by) : undefined;
    if (reviewer?.status !== 'Active' || reviewer.role !== approval.role || (approval.user_id && reviewer.id !== approval.user_id)) {
      throw new ConflictException('Người đã duyệt không còn đủ quyền; Farm chưa được thay đổi');
    }
  }
}
