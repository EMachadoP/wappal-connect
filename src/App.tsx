import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

// Lazy loading components
const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const Inbox = lazy(() => import("./pages/Inbox"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminAI = lazy(() => import("./pages/AdminAI"));
const AdminKnowledge = lazy(() => import("./pages/AdminKnowledge"));
const AdminZAPI = lazy(() => import("./pages/AdminZAPI"));
const AdminContacts = lazy(() => import("./pages/AdminContacts"));
const AdminDuplicates = lazy(() => import("./pages/AdminDuplicates"));
const AdminIntegrations = lazy(() => import("./pages/AdminIntegrations"));
const Status = lazy(() => import("./pages/Status"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="h-screen w-full flex items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/ai" element={<AdminAI />} />
              <Route path="/admin/knowledge" element={<AdminKnowledge />} />
              <Route path="/admin/zapi" element={<AdminZAPI />} />
              <Route path="/admin/contacts" element={<AdminContacts />} />
              <Route path="/admin/duplicates" element={<AdminDuplicates />} />
              <Route path="/admin/integrations" element={<AdminIntegrations />} />
              <Route path="/inbox/:id" element={<Inbox />} />
              <Route path="/status" element={<Status />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;