export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export const logger = {
  log: (level: LogLevel, message: string, metadata: Record<string, unknown> = {}) => {
    // Filtro para os logs de auth redundantes do runtime
    if (message.includes('auth settings') || message.includes('experimental feature')) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...metadata,
      environment: Deno.env.get('ENVIRONMENT') || 'production'
    };

    // Output JSON estruturado para ferramentas de log (Datadog/Grafana)
    console.log(JSON.stringify(logEntry));

    // Se for crítico, poderíamos disparar um webhook aqui ou salvar no DB
  },
  info: (msg: string, meta?: any) => logger.log('INFO', msg, meta),
  warn: (msg: string, meta?: any) => logger.log('WARN', msg, meta),
  error: (msg: string, meta?: any) => logger.log('ERROR', msg, meta),
  critical: (msg: string, meta?: any) => logger.log('CRITICAL', msg, meta),
};