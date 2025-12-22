import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { MessageSquare, MessageCircle, CheckCircle, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Stats {
  total: number;
  open: number;
  resolved: number;
  thisMonth: number;
}

interface DailyData {
  name: string;
  conversas: number;
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<Stats>({ total: 0, open: 0, resolved: 0, thisMonth: 0 });
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchStats = async () => {
      // Total conversations
      const { count: total } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true });

      // Open conversations
      const { count: open } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'open');

      // Resolved conversations
      const { count: resolved } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'resolved');

      // This month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { count: thisMonth } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfMonth.toISOString());

      setStats({
        total: total || 0,
        open: open || 0,
        resolved: resolved || 0,
        thisMonth: thisMonth || 0,
      });

      // Daily data for last 7 days
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 999);

        const { count } = await supabase
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', dayStart.toISOString())
          .lte('created_at', dayEnd.toISOString());

        days.push({
          name: date.toLocaleDateString('pt-BR', { weekday: 'short' }),
          conversas: count || 0,
        });
      }

      setDailyData(days);
      setLoading(false);
    };

    fetchStats();
  }, [user]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const statCards = [
    { title: 'Total de Conversas', value: stats.total, icon: MessageSquare, color: 'text-primary' },
    { title: 'Conversas Abertas', value: stats.open, icon: MessageCircle, color: 'text-warning' },
    { title: 'Conversas Resolvidas', value: stats.resolved, icon: CheckCircle, color: 'text-success' },
    { title: 'Conversas deste Mês', value: stats.thisMonth, icon: Calendar, color: 'text-info' },
  ];

  return (
    <AppLayout>
      <div className="p-6 space-y-6 overflow-auto h-full">
        <h1 className="text-2xl font-bold">Dashboard</h1>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {statCards.map((stat) => {
                const Icon = stat.icon;
                return (
                  <Card key={stat.title}>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        {stat.title}
                      </CardTitle>
                      <Icon className={`w-5 h-5 ${stat.color}`} />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">{stat.value}</div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Conversas por Dia</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="name" className="text-muted-foreground" />
                      <YAxis className="text-muted-foreground" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 'var(--radius)',
                        }}
                      />
                      <Bar dataKey="conversas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}