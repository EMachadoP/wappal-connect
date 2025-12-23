import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';

interface Condominium {
  id: string;
  name: string;
  is_default?: boolean;
}

interface CondominiumSelectorProps {
  condominiums: Condominium[];
  activeCondominiumId: string | null;
  activeCondominiumSetBy?: string | null;
  loading?: boolean;
  onSelect: (condominiumId: string) => void;
}

export function CondominiumSelector({
  condominiums,
  activeCondominiumId,
  activeCondominiumSetBy,
  loading,
  onSelect,
}: CondominiumSelectorProps) {
  const activeCondominium = condominiums.find(c => c.id === activeCondominiumId);
  const hasMultiple = condominiums.length > 1;
  const needsSelection = !activeCondominiumId && condominiums.length > 0;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Carregando condomínios...</span>
      </div>
    );
  }

  if (condominiums.length === 0) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Building2 className="w-4 h-4" />
        <span>Nenhum condomínio vinculado</span>
      </div>
    );
  }

  if (!hasMultiple && activeCondominium) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1.5 py-1">
          <Building2 className="w-3.5 h-3.5 text-primary" />
          <span className="font-medium">{activeCondominium.name}</span>
        </Badge>
        {activeCondominiumSetBy && (
          <span className="text-xs text-muted-foreground">
            (auto)
          </span>
        )}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={needsSelection ? 'destructive' : 'outline'}
          size="sm"
          className="gap-1.5"
        >
          <Building2 className="w-4 h-4" />
          {activeCondominium ? (
            <span className="max-w-32 truncate">{activeCondominium.name}</span>
          ) : (
            <span>Selecionar Condomínio</span>
          )}
          <ChevronDown className="w-3.5 h-3.5 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {condominiums.map((condo) => (
          <DropdownMenuItem
            key={condo.id}
            onClick={() => onSelect(condo.id)}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              <span>{condo.name}</span>
              {condo.is_default && (
                <Badge variant="secondary" className="text-xs py-0 px-1">
                  Padrão
                </Badge>
              )}
            </div>
            {condo.id === activeCondominiumId && (
              <Check className="w-4 h-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Quick selection chips for AI prompt responses
interface CondominiumChipsProps {
  condominiums: Condominium[];
  onSelect: (condominiumId: string) => void;
}

export function CondominiumChips({ condominiums, onSelect }: CondominiumChipsProps) {
  return (
    <div className="flex flex-wrap gap-2 p-3 bg-muted/50 rounded-lg border border-border">
      <span className="text-sm text-muted-foreground w-full mb-1">
        Selecione o condomínio:
      </span>
      {condominiums.map((condo) => (
        <Button
          key={condo.id}
          variant="outline"
          size="sm"
          onClick={() => onSelect(condo.id)}
          className="gap-1.5"
        >
          <Building2 className="w-4 h-4" />
          {condo.name}
        </Button>
      ))}
    </div>
  );
}
