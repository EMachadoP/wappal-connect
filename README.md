# G7 Client Connector

WhatsApp Chat Hub - Gerencie conversas do WhatsApp em uma interface profissional integrada com IA, Asana e Z-API.

## Tecnologias

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui.
- **Backend:** Supabase (Auth, Database, Edge Functions).
- **Integrações:** Z-API (WhatsApp), Asana (Tarefas), OpenAI/Gemini (IA).

## Desenvolvimento Local

1.  **Clone o repositório:**
    ```sh
    git clone <YOUR_GIT_URL>
    cd g7-client-connector
    ```

2.  **Instale as dependências:**
    ```sh
    npm install
    ```

3.  **Configure as variáveis de ambiente:**
    Crie um arquivo `.env` baseado nas chaves necessárias (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY).

4.  **Inicie o servidor de desenvolvimento:**
    ```sh
    npm run dev
    ```

## Deploy de Edge Functions

O deploy das funções é feito automaticamente via GitHub Actions sempre que houver um push para a branch `main`.

Certifique-se de configurar os seguintes Secrets no seu repositório GitHub:
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_ID`

As variáveis de ambiente das funções (como `ZAPI_TOKEN`, `LOVABLE_API_KEY`, etc) devem ser configuradas diretamente no painel do Supabase em **Project Settings > Edge Functions**.