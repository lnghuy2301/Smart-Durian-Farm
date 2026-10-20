import { DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MockAuthConfig } from '../config/environment';
import { AdminGuard } from './admin.guard';
import { EmailVerificationService } from './email/email-verification.service';
import { DisabledEmailSender, EmailSender, SmtpEmailSender } from './email/email.sender';
import { MockCooperativeStore } from './mock-cooperative.store';
import { RegistrationController } from './registration.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { MockUserStore } from '../auth/mock-user.store';
import { UserManagement } from './user-management';
import { MemoryUserManagement } from './memory-user-management';

@Module({})
export class UsersModule {
  static forDatabase(config: MockAuthConfig, authModule: DynamicModule, persistenceModule: DynamicModule): DynamicModule {
    return { module: UsersModule, imports: [authModule, persistenceModule], controllers: [RegistrationController, UsersController],
      providers: [UsersService, EmailVerificationService, AdminGuard,
        { provide: EmailSender, useFactory: () => config.email ? new SmtpEmailSender(config.email) : new DisabledEmailSender() }],
      exports: [EmailSender] };
  }
  static forMock(config: MockAuthConfig, authModule: DynamicModule = AuthModule.forMock(config)): DynamicModule {
    return {
      module: UsersModule,
      imports: [authModule],
      controllers: [RegistrationController, UsersController],
      exports: [MockCooperativeStore, EmailSender, UserManagement],
      providers: [
        UsersService, MockCooperativeStore, EmailVerificationService, AdminGuard,
        { provide: UserManagement, inject: [MockUserStore, MockCooperativeStore],
          useFactory: (users: MockUserStore, cooperatives: MockCooperativeStore) => new MemoryUserManagement(users, cooperatives) },
        {
          provide: EmailSender,
          useFactory: () => config.email ? new SmtpEmailSender(config.email) : new DisabledEmailSender(),
        },
      ],
    };
  }
}
