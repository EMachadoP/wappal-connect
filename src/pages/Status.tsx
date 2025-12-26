import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Loader2, Wifi, Database, Zap, Activity } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface StatusCheck {
  name: string;
  status: 'checking' | 'ok' | 'error';
  message?: string;
  latency?: number;
  icon: React.ElementType;
}

export default function StatusPage() {
  const [checks, setChecks] = useState<StatusCheck[]>([
    { name: 'API WhatsApp (Z-API)', status: 'checking', icon: Activity },
    { name: 'Banco de Dados', status: 'checking', icon: Database },
    { name: 'IA Engine', status: 'checking', icon: Zap },
  ]);

  const runChecks = async () => {
    setChecks(prev => prev.map(c => ({ ...c, status: 'checking' })));

    // DB Check
    const dbStart = Date.now();
    const { error: dbError } = await supabase.from('profiles').select('id').limit(1);
    const dbLat = Date.now() - dbStart;
    
    // AI Check
    const aiStart = Date.now();
    const { error: aiError } = await supabase.functions.invoke('ai-test', { body: { message: 'ping' } });
    const aiLat = Date.now() - aiStart;

    setChecks([
      { 
        name: 'API WhatsApp (Z-API)', 
        status: 'ok', 
        message: 'Monitorando Webhooks', 
        icon: Activity 
      },
      { 
        name: 'Banco de Dados', 
        status: dbError ? 'error' : 'ok', 
        latency: dbLat,
        message: dbError ? 'Falha' : 'Conectado', 
        icon: Database 
      },
      { 
        name: 'IA Engine', 
        status: aiError ? 'error' : 'ok', 
        latency: aiLat,
        message: aiError ? 'Timeout' : 'Operacional', 
        icon: Zap 
      },
    ]);
  };

  useEffect(() => { runChecks(); }, []);

  return (
    <AppLayout>
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Status do Sistema</h1>
          <Button onClick={runChecks} size="sm" variant="outline">Atualizar</Button>
        </div>

        <div className="grid gap-4">
          {checks.map((check) => {
            const Icon = check.icon;
            return (
              <Card key={check.name}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-full ${check.status === 'ok' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-semibold">{check.name}</p>
                      <p className="text-sm text-muted-foreground">{check.message}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {check.latency && <Badge variant="secondary" className="mr-2">{check.latency}ms</Badge>}
                    {check.status === 'ok' ? <CheckCircle className="inline w-5 h-5 text-green-500" /> : <XCircle className="inline w-5 h-5 text-destructive" />}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}