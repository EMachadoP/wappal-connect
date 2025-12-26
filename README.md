# G7 Client Connector

Hub profissional para gestão de conversas de WhatsApp, integrado com IA e sistemas de gestão (Asana).

## 🚀 Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui.
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions, Realtime).
- **Integrações**: Z-API (WhatsApp), Lovable AI (Gateway de modelos), Asana API.

## 🛠️ Setup Local

1. **Clonar e Instalar**:
   ```bash
   git clone <repo-url>
   npm install
   ```

2. **Configurar Variáveis**:
   Crie um arquivo `.env` com as chaves:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`

3. **Rodar o projeto**:
   ```bash
   npm run dev
   ```

## 📖 Documentação Adicional

- [Arquitetura e Decisões Técnicas](docs/architecture.md)
- [Guia de Contribuição](docs/contributing.md)
- [Troubleshooting & Runbooks](docs/troubleshooting.md)