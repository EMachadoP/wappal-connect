import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { useIsMobile } from '@/hooks/use-mobile';

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
  const isMobile = useIsMobile();
  const activeCondominium = condominiums.find(c => c.id === activeCondominiumId);
  const needsSelection = !activeCondominiumId && condominiums.length > 0;

  const trigger = (
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
  );

  const listItems = condominiums.map((condo) => (
    <div
      key={condo.id}
      onClick={() => onSelect(condo.id)}
      className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted"
    >
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4" />
        <span>{condo.name}</span>
        {condo.is_default && <Badge variant="secondary">Padrão</Badge>}
      </div>
      {condo.id === activeCondominiumId && <Check className="w-4 h-4 text-primary" />}
    </div>
  ));

  if (loading) return <Loader2 className="w-4 h-4 animate-spin" />;

  if (isMobile) {
    return (
      <Drawer>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Selecionar Condomínio</DrawerTitle>
          </DrawerHeader>
          <div className="pb-8">{listItems}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {condominiums.map((condo) => (
          <DropdownMenuItem key={condo.id} onClick={() => onSelect(condo.id)}>
            {condo.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CondominiumChips({ condominiums, onSelect }: { condominiums: Condominium[], onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 p-3 bg-muted/50 rounded-lg border border-border">
      <span className="text-sm text-muted-foreground w-full mb-1">Selecione o condomínio:</span>
      {condominiums.map((condo) => (
        <Button key={condo.id} variant="outline" size="sm" onClick={() => onSelect(condo.id)} className="gap-1.5">
          <Building2 className="w-4 h-4" />
          {condo.name}
        </Button>
      ))}
    </div>
  );
}