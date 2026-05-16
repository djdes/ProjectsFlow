import type { User } from '@/domain/user/User';

export type RequestMagicLinkInput = {
  readonly email: string;
};

export type RequestMagicLinkResult = {
  readonly devMagicUrl: string | null;
};

export type ConsumeMagicLinkInput = {
  readonly token: string;
};

export interface AuthRepository {
  requestMagicLink(input: RequestMagicLinkInput): Promise<RequestMagicLinkResult>;
  consumeMagicLink(input: ConsumeMagicLinkInput): Promise<User>;
  logout(): Promise<void>;
  getCurrentOrNull(): Promise<User | null>;
}
