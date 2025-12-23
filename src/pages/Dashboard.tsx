import { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { MessageSquare, MessageCircle, CheckCircle, Calendar, Bot, Coins, Zap, TrendingUp, Users, ArrowRightLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';

interface Stats {
  total: number;
  open: number;
  resolved: number;
  thisMonth: number;
}

interface DailyData {
  name: string;
  date: string;
  conversas: number;
  tokens: number;
  cost: number;
  aiResponses: number;
}

interface AIStats {
  tokensToday: number;
  tokensMonth: number;
  costToday: number;
  costMonth: number;
  responsesToday: number;
  conversationsWithAI: number;
  handoffRate: number;
}

interface ModelUsage {
  model: string;
  tokens: number;
  count: number;
}

// Estimated costs per 1K tokens (input + output average)
const COST_PER_1K_TOKENS: Record<string, number> = {
  'google/gemini-2.5-flash': 0.00015,
  'google/gemini-2.5-flash-lite': 0.00010,
  'google/gemini-2.5-pro': 0.00125,
  'google/gemini-3-pro-preview': 0.00150,
  'openai/gpt-5': 0.015,
  'openai/gpt-5-mini': 0.0015,
  'openai/gpt-5-nano': 0.0005,
  'gemini-2.0-flash': 0.00015,
  'gemini-2.5-flash-preview-04-17': 0.00015,
  'gemini-3-flash-preview': 0.00015,
  'gpt-4o-mini': 0.00015,
  'default': 0.0005,
};

function estimateCost(tokens: number, model: string): number {
  const costPer1K = COST_PER_1K_TOKENS[model] || COST_PER_1K_TOKENS['default'];
  return (tokens / 1000) * costPer1K;
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<Stats>({ total: 0, open: 0, resolved: 0, thisMonth: 0 });
  const [aiStats, setAIStats] = useState<AIStats>({
    tokensToday: 0,
    tokensMonth: 0,
    costToday: 0,
    costMonth: 0,
    responsesToday: 0,
    conversationsWithAI: 0,
    handoffRate: 0,
  });
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('7d');

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))', '#10b981', '#f59e0b', '#ef4444'];

  useEffect(() => {
    if (!user) return;
    fetchAllData();
  }, [user, period]);

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.all([
      fetchStats(),
      fetchAIStats(),
      fetchDailyData(),
      fetchModelUsage(),
    ]);
    setLoading(false);
  };

  const fetchStats = async () => {
    const [totalRes, openRes, resolvedRes, thisMonthRes] = await Promise.all([
      supabase.from('conversations').select('*', { count: 'exact', head: true }),
      supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'resolved'),
      supabase.from('conversations').select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(new Date().setDate(1)).toISOString()),
    ]);

    setStats({
      total: totalRes.count || 0,
      open: openRes.count || 0,
      resolved: resolvedRes.count || 0,
      thisMonth: thisMonthRes.count || 0,
    });
  };

  const fetchAIStats = async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // Fetch today's usage
    const { data: todayUsage } = await supabase
      .from('ai_usage_logs')
      .select('input_tokens, output_tokens, model')
      .gte('created_at', todayStart.toISOString());

    // Fetch month's usage
    const { data: monthUsage } = await supabase
      .from('ai_usage_logs')
      .select('input_tokens, output_tokens, model, conversation_id')
      .gte('created_at', monthStart.toISOString());

    // Calculate today stats
    let tokensToday = 0;
    let costToday = 0;
    (todayUsage || []).forEach(u => {
      const total = (u.input_tokens || 0) + (u.output_tokens || 0);
      tokensToday += total;
      costToday += estimateCost(total, u.model);
    });

    // Calculate month stats
    let tokensMonth = 0;
    let costMonth = 0;
    const conversationsSet = new Set<string>();
    (monthUsage || []).forEach(u => {
      const total = (u.input_tokens || 0) + (u.output_tokens || 0);
      tokensMonth += total;
      costMonth += estimateCost(total, u.model);
      if (u.conversation_id) conversationsSet.add(u.conversation_id);
    });

    // Count AI responses today (from ai_logs table for accuracy)
    const { count: responsesToday } = await supabase
      .from('ai_logs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'success')
      .gte('created_at', todayStart.toISOString());

    // Calculate handoff rate (conversations that went from AI to human)
    const { data: aiEvents } = await supabase
      .from('ai_events')
      .select('conversation_id, event_type')
      .in('event_type', ['human_takeover', 'customer_requested_human'])
      .gte('created_at', monthStart.toISOString());

    const handoffs = new Set((aiEvents || []).map(e => e.conversation_id)).size;
    const handoffRate = conversationsSet.size > 0 
      ? (handoffs / conversationsSet.size) * 100 
      : 0;

    setAIStats({
      tokensToday,
      tokensMonth,
      costToday,
      costMonth,
      responsesToday: responsesToday || 0,
      conversationsWithAI: conversationsSet.size,
      handoffRate,
    });
  };

  const fetchDailyData = async () => {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const dailyStats: DailyData[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      const [convRes, usageRes, responsesRes] = await Promise.all([
        supabase.from('conversations').select('*', { count: 'exact', head: true })
          .gte('created_at', dayStart.toISOString())
          .lte('created_at', dayEnd.toISOString()),
        supabase.from('ai_usage_logs').select('input_tokens, output_tokens, model')
          .gte('created_at', dayStart.toISOString())
          .lte('created_at', dayEnd.toISOString()),
        supabase.from('ai_logs').select('*', { count: 'exact', head: true })
          .eq('status', 'success')
          .gte('created_at', dayStart.toISOString())
          .lte('created_at', dayEnd.toISOString()),
      ]);

      let dayTokens = 0;
      let dayCost = 0;
      (usageRes.data || []).forEach(u => {
        const total = (u.input_tokens || 0) + (u.output_tokens || 0);
        dayTokens += total;
        dayCost += estimateCost(total, u.model);
      });

      dailyStats.push({
        name: date.toLocaleDateString('pt-BR', { 
          weekday: days <= 7 ? 'short' : undefined,
          day: '2-digit',
          month: days > 7 ? '2-digit' : undefined,
        }),
        date: date.toISOString(),
        conversas: convRes.count || 0,
        tokens: dayTokens,
        cost: dayCost,
        aiResponses: responsesRes.count || 0,
      });
    }

    setDailyData(dailyStats);
  };

  const fetchModelUsage = async () => {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data } = await supabase
      .from('ai_usage_logs')
      .select('model, input_tokens, output_tokens')
      .gte('created_at', startDate.toISOString());

    const modelMap: Record<string, { tokens: number; count: number }> = {};
    (data || []).forEach(u => {
      const model = u.model || 'unknown';
      if (!modelMap[model]) {
        modelMap[model] = { tokens: 0, count: 0 };
      }
      modelMap[model].tokens += (u.input_tokens || 0) + (u.output_tokens || 0);
      modelMap[model].count += 1;
    });

    const usage = Object.entries(modelMap)
      .map(([model, data]) => ({
        model: model.split('/').pop() || model,
        tokens: data.tokens,
        count: data.count,
      }))
      .sort((a, b) => b.tokens - a.tokens);

    setModelUsage(usage);
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatCurrency = (value: number) => {
    return `$${value.toFixed(4)}`;
  };

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

  const conversationCards = [
    { title: 'Total de Conversas', value: stats.total, icon: MessageSquare, color: 'text-primary' },
    { title: 'Conversas Abertas', value: stats.open, icon: MessageCircle, color: 'text-yellow-500' },
    { title: 'Conversas Resolvidas', value: stats.resolved, icon: CheckCircle, color: 'text-green-500' },
    { title: 'Conversas deste Mês', value: stats.thisMonth, icon: Calendar, color: 'text-blue-500' },
  ];

  const aiCards = [
    { title: 'Tokens Hoje', value: formatNumber(aiStats.tokensToday), icon: Zap, color: 'text-yellow-500' },
    { title: 'Tokens Mês', value: formatNumber(aiStats.tokensMonth), icon: TrendingUp, color: 'text-blue-500' },
    { title: 'Custo Hoje', value: formatCurrency(aiStats.costToday), icon: Coins, color: 'text-green-500' },
    { title: 'Custo Mês', value: formatCurrency(aiStats.costMonth), icon: Coins, color: 'text-primary' },
    { title: 'Respostas IA Hoje', value: aiStats.responsesToday, icon: Bot, color: 'text-purple-500' },
    { title: 'Conversas com IA', value: aiStats.conversationsWithAI, icon: Users, color: 'text-cyan-500' },
    { title: 'Taxa Handoff', value: `${aiStats.handoffRate.toFixed(1)}%`, icon: ArrowRightLeft, color: 'text-orange-500' },
  ];

  return (
    <AppLayout>
      <div className="p-6 space-y-6 overflow-auto h-full">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <Select value={period} onValueChange={(v) => setPeriod(v as '7d' | '30d' | '90d')}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">7 dias</SelectItem>
              <SelectItem value="30d">30 dias</SelectItem>
              <SelectItem value="90d">90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Visão Geral</TabsTrigger>
              <TabsTrigger value="ai">Uso de IA</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6 mt-6">
              {/* Conversation Stats */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {conversationCards.map((stat) => {
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

              {/* Daily Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Conversas por Dia</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="name" className="text-muted-foreground" fontSize={12} />
                        <YAxis className="text-muted-foreground" fontSize={12} />
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
            </TabsContent>

            <TabsContent value="ai" className="space-y-6 mt-6">
              {/* AI Stats Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
                {aiCards.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <Card key={stat.title}>
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground">
                          {stat.title}
                        </CardTitle>
                        <Icon className={`w-4 h-4 ${stat.color}`} />
                      </CardHeader>
                      <CardContent>
                        <div className="text-xl font-bold">{stat.value}</div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Tokens per Day */}
                <Card>
                  <CardHeader>
                    <CardTitle>Tokens por Dia</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dailyData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="name" className="text-muted-foreground" fontSize={12} />
                          <YAxis className="text-muted-foreground" fontSize={12} tickFormatter={formatNumber} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--card))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: 'var(--radius)',
                            }}
                            formatter={(value: number) => [formatNumber(value), 'Tokens']}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="tokens" 
                            stroke="hsl(var(--primary))" 
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Cost per Day */}
                <Card>
                  <CardHeader>
                    <CardTitle>Custo por Dia (USD)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dailyData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="name" className="text-muted-foreground" fontSize={12} />
                          <YAxis className="text-muted-foreground" fontSize={12} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--card))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: 'var(--radius)',
                            }}
                            formatter={(value: number) => [formatCurrency(value), 'Custo']}
                          />
                          <Bar dataKey="cost" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Model Usage */}
                <Card>
                  <CardHeader>
                    <CardTitle>Uso por Modelo</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]">
                      {modelUsage.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={modelUsage}
                              dataKey="tokens"
                              nameKey="model"
                              cx="50%"
                              cy="50%"
                              outerRadius={80}
                              label={({ model, percent }) => `${model} (${(percent * 100).toFixed(0)}%)`}
                            >
                              {modelUsage.map((_, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip 
                              formatter={(value: number) => [formatNumber(value), 'Tokens']}
                              contentStyle={{
                                backgroundColor: 'hsl(var(--card))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: 'var(--radius)',
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                          Nenhum dado de modelo disponível
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* AI Responses per Day */}
                <Card>
                  <CardHeader>
                    <CardTitle>Respostas IA por Dia</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dailyData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="name" className="text-muted-foreground" fontSize={12} />
                          <YAxis className="text-muted-foreground" fontSize={12} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--card))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: 'var(--radius)',
                            }}
                          />
                          <Bar dataKey="aiResponses" name="Respostas IA" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}
