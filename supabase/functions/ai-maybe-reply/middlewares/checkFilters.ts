import { Context, Middleware } from '../types.ts';
import { OutsideBusinessHoursError, SupplierDetectedError } from '../errors.ts';

export const checkFiltersMiddleware: Middleware = async (ctx, next) => {
  const { conversation, contact, lastMessage, settings } = ctx;
  if (!conversation || !settings) return;

  // 1. Verificar modo da IA
  if (conversation.ai_mode === 'OFF') return;

  // 2. Verificar controle humano
  if (conversation.human_control && conversation.typing_lock_until) {
    if (new Date(conversation.typing_lock_until) > new Date()) return;
  }

  // 3. Fornecedor
  const tags = contact?.tags || [];
  if (tags.includes('fornecedor')) {
    throw new SupplierDetectedError(['tag_fornecedor']);
  }

  // 4. Horário Comercial (Simplificado para o exemplo)
  // No mundo real, usaria a lógica de schedule_json do seu settings
  const hour = new Date().getHours();
  if (hour < 8 || hour >= 18) {
    throw new OutsideBusinessHoursError();
  }

  await next();
};