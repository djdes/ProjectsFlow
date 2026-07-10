// 404: предложение не найдено.
export class CloseProposalNotFoundError extends Error {
  constructor(id: string) {
    super(`Close proposal ${id} not found`);
    this.name = 'CloseProposalNotFoundError';
  }
}

// 409: предложение уже разрешено (confirmed/dismissed/expired) — подтвердить/отклонить нельзя.
// Не считаем это фатальной ошибкой: идемпотентность важна (дубль кнопок в личке и группе),
// caller мапит в no-op/дружелюбный ответ.
export class CloseProposalNotOpenError extends Error {
  constructor(
    id: string,
    public readonly currentStatus: string,
  ) {
    super(`Close proposal ${id} is not open (status: ${currentStatus})`);
    this.name = 'CloseProposalNotOpenError';
  }
}
