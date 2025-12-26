# Arquitetura do Sistema

## Visão Geral
O G7 Client Connector utiliza uma arquitetura "Serverless-first" baseada no ecossistema Supabase.

## Componentes Chave
1. **Realtime Engine**: Utilizamos o Supabase Realtime para sincronizar mensagens entre o atendente e o cliente sem necessidade de refresh.
2. **Edge Functions**: Toda a lógica pesada e integrações sensíveis (IA, Asana, Z-API) rodam em funções Deno isoladas para segurança.
3. **Identidade Visual**: Baseada em shadcn/ui para garantir acessibilidade e consistência mobile-first.

## Decisões Técnicas
- **Z-API**: Escolhida pela estabilidade em grandes volumes de grupos e suporte a instâncias múltiplas.
- **Lovable AI Gateway**: Utilizado para alternar entre modelos (Gemini/GPT) sem mudar o código das funções.
- **RLS (Row Level Security)**: Segurança em nível de banco garantindo que agentes só vejam conversas permitidas.