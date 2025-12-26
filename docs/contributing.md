# Guia de Contribuição

## Fluxo de Trabalho (Git)
- `main`: Ambiente de produção.
- `develop`: Ambiente de homologação (staging).
- Features devem sair da `develop` e retornar via Pull Request.

## Padrões de Código
- **Componentes**: Máximo de 100 linhas por arquivo.
- **Hooks**: Toda lógica de dados deve estar em hooks customizados (ex: `useConversations`).
- **Commits**: Seguir padrão de commits semânticos (feat, fix, docs, style).

## Processo de PR
1. Execute `npm test` localmente.
2. Garanta que o deploy em staging funcionou.
3. Solicite review de pelo menos um par.