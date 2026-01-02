# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não Lançado]

### Em Desenvolvimento
- Melhorias futuras serão listadas aqui

---

## [1.1.0] - 2026-01-02

### ✨ Adicionado
- Fallback automático para variáveis de ambiente Supabase (`VITE_SUPABASE_PUBLISHABLE_KEY` ou `VITE_SUPABASE_ANON_KEY`)
- Validação de variáveis de ambiente com mensagem de erro clara
- Extração automática de nome de condomínio do resumo em notificações de protocolo
- Detecção melhorada de tipo de mídia em mensagens do WhatsApp

### 🐛 Corrigido
- **[CRÍTICO]** Erro "Invalid API key" no login de produção
- Vídeos e imagens não sendo renderizados (mostravam como texto "ReceivedCallback")
- Campo "Condomínio" mostrando "Não Identificado" quando nome estava no resumo
- Rewrites SPA para React Router (rotas `/auth`, `/inbox`, etc. retornavam 404)

### 🔧 Alterado
- Webhook Z-API agora detecta tipo de mídia pelos campos do payload primeiro, depois por `type`
- Função `protocol-opened` extrai nome do condomínio usando regex quando não fornecido diretamente

### 📝 Documentação
- Criado guia de limpeza de variáveis de ambiente do Vercel
- Criado walkthrough de sucesso do deployment
- Documentado processo de correção de "Invalid API key"

---

## [1.0.0] - 2025-12-XX

### ✨ Inicial
- Sistema de atendimento WhatsApp via Z-API
- Integração com Supabase (autenticação, banco de dados, Edge Functions)
- Interface de inbox para gerenciar conversas
- Sistema de protocolos com integração Asana
- Atribuição de conversas para agentes
- IA para respostas automáticas
- PWA (Progressive Web App) configurado
- Painel administrativo
- Gerenciamento de contatos e duplicatas
- Sistema de conhecimento (Knowledge Base)

---

## Tipos de Mudanças

- `✨ Adicionado` - Novas funcionalidades
- `🔧 Alterado` - Mudanças em funcionalidades existentes
- `🗑️ Removido` - Funcionalidades removidas
- `🐛 Corrigido` - Correções de bugs
- `🔒 Segurança` - Correções de vulnerabilidades
- `📝 Documentação` - Mudanças na documentação
- `⚡ Performance` - Melhorias de performance
- `🎨 UI/UX` - Melhorias de interface

---

## Versionamento

Este projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/):

- **MAJOR** (X.0.0) - Mudanças incompatíveis com versões anteriores
- **MINOR** (0.X.0) - Novas funcionalidades compatíveis
- **PATCH** (0.0.X) - Correções de bugs compatíveis
