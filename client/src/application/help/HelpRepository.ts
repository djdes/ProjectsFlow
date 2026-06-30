import type { SupportSource } from '@/domain/help/Support';

export type SubmitSupportInput = {
  readonly message: string;
  readonly source: SupportSource;
};

// Port: доставка обращения в поддержку. Реализация — HttpHelpRepository (POST
// /api/help/contact-support). AI-помощник пока не входит в порт: его подключение к
// диспетчеру отложено (см. план P2), UI показывает превью «скоро».
export interface HelpRepository {
  submitSupport(input: SubmitSupportInput): Promise<void>;
}
