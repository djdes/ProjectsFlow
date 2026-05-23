import type { User, UserWithSecrets } from '../../domain/user/User.js';

export type CreateUserInput = {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string;
};

export type UpdateProfileInput = {
  readonly displayName: string;
  readonly email: string;
};

export interface UserRepository {
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<UserWithSecrets | null>;
  // Батч для админ-страниц / dispatcher-кандидатов: id'шки → users (без секретов).
  // Сортировка не гарантирована — caller сам упорядочит при нужде.
  getManyByIds(ids: readonly string[]): Promise<User[]>;
  // Все юзеры с isAdmin=true. Используется для расширения dispatcher-candidates:
  // админы — валидные диспетчеры в любом проекте (admin-bypass даёт им access).
  listAdmins(): Promise<User[]>;
  create(input: CreateUserInput): Promise<User>;
  updateProfile(id: string, input: UpdateProfileInput): Promise<User>;
}
