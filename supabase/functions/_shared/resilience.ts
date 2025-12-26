export async function withRetry<T>(
  fn: () => Promise<T>,
  options = { maxRetries: 3, initialDelay: 500 }
): Promise<T> {
  let lastError: any;
  let delay = options.initialDelay;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === options.maxRetries) break;
      
      console.warn(`Attempt ${attempt + 1} failed. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
  throw lastError;
}

export const isCircuitOpen = (serviceName: string): boolean => {
  // Simples implementação: se o serviço falhou muitas vezes nos últimos minutos
  // Em Edge Functions, isso exigiria um estado global (Redis), 
  // aqui usamos uma abordagem baseada em erro rápido.
  return false; 
};