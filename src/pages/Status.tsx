import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Loader2, Wifi, Database, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface StatusCheck {
  name: string;
  status: 'checking' | 'ok' | 'error';
  message?: string;
  icon: React.ElementType;
}

const APP_VERSION = '1.0.0';

export default function StatusPage() {
  const [checks, setChecks] = useState<StatusCheck[]>([
    { name: 'Conexão com Internet', status: 'checking', icon: Wifi },
    { name: 'Banco de Dados', status: 'checking', icon: Database },
    { name: 'Edge Functions', status: 'checking', icon: Zap },
  ]);

  const runChecks = async () => {
    setChecks(prev => prev.map(c => ({ ...c, status: 'checking' as const })));

    // Check internet
    const internetOk = navigator.onLine;
    setChecks(prev => prev.map(c => 
      c.name === 'Conexão com Internet' 
        ? { ...c, status: internetOk ? 'ok' : 'error', message: internetOk ? 'Online' : 'Offline' }
        : c
    ));

    // Check Supabase DB
    try {
      const { error } = await supabase.from('profiles').select('id').limit(1);
      setChecks(prev => prev.map(c => 
        c.name === 'Banco de Dados' 
          ? { ...c, status: error ? 'error' : 'ok', message: error?.message || 'Conectado' }
          : c
      ));
    } catch (e) {
      setChecks(prev => prev.map(c => 
        c.name === 'Banco de Dados' 
          ? { ...c, status: 'error', message: 'Falha na conexão' }
          : c
      ));
    }

    // Check Edge Functions
    try {
      const start = Date.now();
      const { error } = await supabase.functions.invoke('ai-test', {
        body: { message: 'ping' },
      });
      const latency = Date.now() - start;
      setChecks(prev => prev.map(c => 
        c.name === 'Edge Functions' 
          ? { ...c, status: error ? 'error' : 'ok', message: error?.message || `OK (${latency}ms)` }
          : c
      ));
    } catch (e) {
      setChecks(prev => prev.map(c => 
        c.name === 'Edge Functions' 
          ? { ...c, status: 'error', message: 'Indisponível' }
          : c
      ));
    }
  };

  useEffect(() => {
    runChecks();
  }, []);

  const allOk = checks.every(c => c.status === 'ok');
  const checking = checks.some(c => c.status === 'checking');

  return (
    <AppLayout>
      <div className="p-6 max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Status do Sistema</h1>
          <p className="text-muted-foreground">G7 Client Connector v{APP_VERSION}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {checking ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              ) : allOk ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-destructive" />
              )}
              {checking ? 'Verificando...' : allOk ? 'Tudo OK' : 'Problemas detectados'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {checks.map((check) => {
              const Icon = check.icon;
              return (
                <div key={check.name} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Icon className="w-5 h-5 text-muted-foreground" />
                    <span className="font-medium">{check.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{check.message}</span>
                    {check.status === 'checking' && <Loader2 className="w-4 h-4 animate-spin" />}
                    {check.status === 'ok' && <CheckCircle className="w-4 h-4 text-green-500" />}
                    {check.status === 'error' && <XCircle className="w-4 h-4 text-destructive" />}
                  </div>
                </div>
              );
            })}

            <Button onClick={runChecks} variant="outline" className="w-full" disabled={checking}>
              {checking ? 'Verificando...' : 'Verificar novamente'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
