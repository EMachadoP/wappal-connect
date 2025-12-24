export class PipelineAbortError extends Error {
  constructor(public reason: string, public shouldLog = false) {
    super(reason);
    this.name = 'PipelineAbortError';
  }
}

export class BotDetectedError extends PipelineAbortError {
  constructor(score: number) {
    super(`Possível bot detectado (score: ${score}), abortando resposta`, true);
    this.name = 'BotDetectedError';
  }
}

export class OutsideBusinessHoursError extends PipelineAbortError {
  constructor() {
    super('Fora do horário de atendimento comercial', false);
    this.name = 'OutsideBusinessHoursError';
  }
}

export class SupplierDetectedError extends PipelineAbortError {
  constructor(keywords: string[]) {
    super(`Mensagem de fornecedor detectada: ${keywords.join(', ')}`, true);
    this.name = 'SupplierDetectedError';
  }
}