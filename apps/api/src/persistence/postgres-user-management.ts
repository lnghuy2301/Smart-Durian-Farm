import { UserManagement, RegisteredAccountInput } from '../users/user-management';
import { ApproveManagerDto } from '../users/users.dto';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresCooperativesRepository } from './postgres-cooperatives.repository';

// Hai repository phải nhận cùng DatabaseService.postgres. Adapter không sở hữu
// pool hoặc dữ liệu; approve/reject dùng một transaction của registry HTX.
export class PostgresUserManagement extends UserManagement {
  constructor(private readonly users: PostgresUsersRepository, private readonly cooperatives: PostgresCooperativesRepository) { super(); }
  async assertAvailable(phone: string, email: string | null = null) { return this.users.assertAvailable(phone, email); }
  async createRegisteredUser(input: RegisteredAccountInput, verifiedEmail: string | null = null) {
    return (await this.users.createRegisteredUser(input, verifiedEmail)).user;
  }
  async pendingManagers(adminId: string) { return this.cooperatives.pendingManagers(adminId); }
  async listCooperatives(adminId: string) { return this.cooperatives.list(adminId, true); }
  async approve(adminId: string, userId: string, input: ApproveManagerDto) { return this.cooperatives.approve(adminId, userId, input); }
  async reject(adminId: string, userId: string) { return this.cooperatives.reject(adminId, userId); }
}
