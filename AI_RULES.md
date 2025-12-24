# G7 Client Connector - AI Rules & Tech Stack

## Tech Stack
*   **React 18** with **TypeScript** as the core UI framework.
*   **Vite** as the build tool and development server.
*   **Tailwind CSS** for utility-first styling and responsive design.
*   **shadcn/ui** (based on Radix UI) for high-quality, accessible UI components.
*   **Supabase** for Backend-as-a-Service (Database, Auth, Storage, Edge Functions).
*   **React Router Dom** for client-side navigation.
*   **TanStack Query** for efficient data fetching, caching, and synchronization.
*   **React Hook Form** + **Zod** for schema-based form handling and validation.
*   **date-fns** for date and time manipulation.
*   **Lucide React** for consistent iconography.

## Library Usage Rules
*   **UI Components:** Always use or extend `shadcn/ui` components found in `@/components/ui`. Do not install external UI kits like MUI or Bootstrap.
*   **Styling:** Exclusively use **Tailwind CSS** utility classes. Avoid writing custom CSS in `.css` files unless strictly necessary for complex animations or legacy overrides.
*   **Icons:** Use **Lucide React** for all iconography to maintain visual consistency.
*   **Forms:** Implement all forms using **React Hook Form**. Use **Zod** for schema validation.
*   **Data Fetching:** Use **TanStack Query** (`useQuery`, `useMutation`) for all external data fetching. Do not use raw `useEffect` for data loading if a query hook is appropriate.
*   **Backend Interactions:** Use the pre-configured **Supabase client** in `@/integrations/supabase/client`.
*   **Date Handling:** Use **date-fns** for any date formatting, comparison, or manipulation.
*   **Notifications:** Use **Sonner** (via the `toast` utility) for user feedback and notifications.
*   **State Management:** Prefer **React Context** or **URL state** (search params) for shared UI state. Use TanStack Query for server state.