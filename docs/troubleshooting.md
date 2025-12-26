# Troubleshooting & Runbooks

## 1. WhatsApp Desconectado (Z-API)
**Sintoma**: Mensagens não saem ou chegam.
**Solução**:
1. Vá em Admin -> Z-API.
2. Clique em "Testar Conexão".
3. Se falhar, verifique se o QR Code expirou no painel da Z-API.

## 2. IA não responde
**Sintoma**: Conversa fica "parada" após mensagem do cliente.
**Solução**:
1. Verifique a página de [Status](/status).
2. Veja os logs em Admin -> IA -> Logs para erros de cota (Quota Exceeded).
3. Verifique se o `LOVABLE_API_KEY` está configurado nos secrets do Supabase.

## 3. Protocolos não aparecem no Asana
**Sintoma**: Protocolo gerado no chat mas tarefa não existe.
**Solução**:
1. Verifique se a Categoria do protocolo tem um Section ID mapeado em Admin -> Integrações.
2. Cheque os logs da Edge Function `protocol-opened` no dashboard do Supabase.