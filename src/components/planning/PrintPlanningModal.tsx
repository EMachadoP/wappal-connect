import { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface PlanItem {
    id: string;
    plan_date: string;
    start_minute: number;
    end_minute: number;
    technician_id: string;
    technician_name: string;
    condominium_name: string | null;
    protocol_code: string | null;
    protocol_summary: string | null;
    manual_title: string | null;
    work_item_status: string | null;
}

interface Technician {
    id: string;
    name: string;
}

interface PrintPlanningModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    planItems: PlanItem[];
    technicians: Technician[];
    weekStart: Date;
    weekDays: Date[];
}

function minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function PrintPlanningModal({
    open,
    onOpenChange,
    planItems,
    technicians,
    weekStart,
    weekDays
}: PrintPlanningModalProps) {
    const printRef = useRef<HTMLDivElement>(null);

    const handlePrint = () => {
        const content = printRef.current;
        if (!content) return;

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Popup bloqueado. Permita popups para imprimir.');
            return;
        }

        printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Planejamento - Semana de ${format(weekStart, "d 'de' MMMM", { locale: ptBR })}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 10px; padding: 10px; }
          h1 { font-size: 14px; margin-bottom: 5px; }
          h2 { font-size: 11px; color: #666; margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #ccc; padding: 4px; text-align: left; vertical-align: top; }
          th { background: #f0f0f0; font-weight: bold; }
          .tech-name { font-weight: bold; background: #e8e8e8; }
          .item { margin-bottom: 4px; padding: 3px; border: 1px solid #ddd; border-radius: 3px; font-size: 9px; }
          .item-time { font-weight: bold; }
          .item-title { }
          .item-code { color: #666; font-size: 8px; }
          .done { opacity: 0.5; text-decoration: line-through; }
          .manual { background: #fff3cd; }
          @media print {
            body { padding: 0; }
            table { page-break-inside: auto; }
            tr { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        ${content.innerHTML}
        <script>window.onload = function() { window.print(); window.close(); }</script>
      </body>
      </html>
    `);
        printWindow.document.close();
    };

    const getItemsForCell = (techId: string, dateStr: string) => {
        return planItems
            .filter(item => item.technician_id === techId && item.plan_date === dateStr)
            .sort((a, b) => a.start_minute - b.start_minute);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Printer className="h-5 w-5" />
                        Visualização para Impressão
                    </DialogTitle>
                </DialogHeader>

                <div ref={printRef} className="p-4 bg-white">
                    <h1>G7 Serv - Planejamento Semanal</h1>
                    <h2>Semana de {format(weekStart, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}</h2>

                    <table>
                        <thead>
                            <tr>
                                <th style={{ width: '100px' }}>Técnico</th>
                                {weekDays.map((day) => (
                                    <th key={day.toISOString()} style={{ minWidth: '120px' }}>
                                        {format(day, 'EEE d/MM', { locale: ptBR })}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {technicians.map((tech) => (
                                <tr key={tech.id}>
                                    <td className="tech-name">{tech.name}</td>
                                    {weekDays.map((day) => {
                                        const dateStr = format(day, 'yyyy-MM-dd');
                                        const items = getItemsForCell(tech.id, dateStr);
                                        return (
                                            <td key={dateStr}>
                                                {items.map((item) => (
                                                    <div
                                                        key={item.id}
                                                        className={`item ${item.work_item_status === 'done' ? 'done' : ''} ${item.manual_title ? 'manual' : ''}`}
                                                    >
                                                        <div className="item-time">
                                                            {minutesToTime(item.start_minute)}-{minutesToTime(item.end_minute)}
                                                        </div>
                                                        <div className="item-title">
                                                            {item.condominium_name || item.manual_title || 'Sem título'}
                                                        </div>
                                                        {item.protocol_code && (
                                                            <div className="item-code">{item.protocol_code}</div>
                                                        )}
                                                    </div>
                                                ))}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <p style={{ marginTop: '20px', fontSize: '8px', color: '#999' }}>
                        Impresso em {format(new Date(), "dd/MM/yyyy 'às' HH:mm")}
                    </p>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Fechar
                    </Button>
                    <Button onClick={handlePrint}>
                        <Printer className="h-4 w-4 mr-2" />
                        Imprimir
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
