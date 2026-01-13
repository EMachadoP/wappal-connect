import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    FileText,
    Plus,
    Pencil,
    Copy,
    Save,
    Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

interface Template {
    id: string;
    category: string;
    title: string;
    default_minutes: number;
    required_people: number;
    required_skill_codes: string[];
    default_materials: Material[];
    criticality: string;
    sla_business_days: number;
    active: boolean;
    created_at: string;
}

interface Material {
    name: string;
    quantity: number;
    unit: string;
}

interface Skill {
    id: string;
    code: string;
    label: string;
}

const CATEGORIES = [
    { value: 'operational', label: 'Operacional' },
    { value: 'support', label: 'Suporte' },
    { value: 'admin', label: 'Administrativo' },
    { value: 'financial', label: 'Financeiro' },
];

const categoryLabels: Record<string, string> = {
    operational: 'Operacional',
    support: 'Suporte',
    admin: 'Administrativo',
    financial: 'Financeiro',
};

export default function SettingsTemplates() {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterCategory, setFilterCategory] = useState<string>('all');
    const [filterActive, setFilterActive] = useState<string>('all');

    // Form state
    const [showModal, setShowModal] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
    const [form, setForm] = useState({
        category: 'operational',
        title: '',
        default_minutes: 60,
        required_people: 1,
        required_skill_codes: [] as string[],
        default_materials: [] as Material[],
        criticality: 'non_critical',
        sla_business_days: 2,
        active: true,
    });

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const { data: templateData } = await supabase
                .from('task_templates')
                .select('*')
                .order('category')
                .order('title');

            setTemplates((templateData || []).map((t: any) => ({
                ...t,
                default_materials: t.default_materials || [],
            })));

            const { data: skillData } = await supabase
                .from('skills')
                .select('*')
                .order('code');
            setSkills(skillData || []);
        } catch (err) {
            console.error('Error fetching templates:', err);
            toast.error('Erro ao carregar templates');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const filteredTemplates = templates.filter(t => {
        if (filterCategory !== 'all' && t.category !== filterCategory) return false;
        if (filterActive === 'active' && !t.active) return false;
        if (filterActive === 'inactive' && t.active) return false;
        return true;
    });

    const openModal = (template?: Template, isDuplicate = false) => {
        if (template) {
            setEditingTemplate(isDuplicate ? null : template);
            setForm({
                category: template.category,
                title: isDuplicate ? `${template.title} (cópia)` : template.title,
                default_minutes: template.default_minutes,
                required_people: template.required_people,
                required_skill_codes: template.required_skill_codes || [],
                default_materials: template.default_materials || [],
                criticality: template.criticality || 'non_critical',
                sla_business_days: template.sla_business_days ?? 2,
                active: template.active,
            });
        } else {
            setEditingTemplate(null);
            setForm({
                category: 'operational',
                title: '',
                default_minutes: 60,
                required_people: 1,
                required_skill_codes: [],
                default_materials: [],
                criticality: 'non_critical',
                sla_business_days: 2,
                active: true,
            });
        }
        setShowModal(true);
    };

    const saveTemplate = async () => {
        if (form.title.length < 3) {
            toast.error('Título deve ter pelo menos 3 caracteres');
            return;
        }
        if (form.default_minutes < 15 || form.default_minutes > 480) {
            toast.error('Duração deve ser entre 15 e 480 minutos');
            return;
        }
        if (form.required_people < 1 || form.required_people > 4) {
            toast.error('Pessoas deve ser entre 1 e 4');
            return;
        }

        // Validate skill codes exist
        const validCodes = skills.map(s => s.code);
        const invalidSkills = form.required_skill_codes.filter(c => !validCodes.includes(c));
        if (invalidSkills.length > 0) {
            toast.error(`Skills inválidas: ${invalidSkills.join(', ')}`);
            return;
        }

        try {
            const payload = {
                category: form.category,
                title: form.title,
                default_minutes: form.default_minutes,
                required_people: form.required_people,
                required_skill_codes: form.required_skill_codes,
                default_materials: form.default_materials,
                criticality: form.criticality,
                sla_business_days: form.sla_business_days,
                active: form.active,
            };

            if (editingTemplate) {
                const { error } = await supabase
                    .from('task_templates')
                    .update(payload)
                    .eq('id', editingTemplate.id);
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('task_templates')
                    .insert(payload);
                if (error) throw error;
            }

            toast.success(editingTemplate ? 'Template atualizado!' : 'Template criado!');
            setShowModal(false);
            fetchData();
        } catch (err) {
            console.error('Error saving template:', err);
            toast.error('Erro ao salvar template');
        }
    };

    const toggleSkillCode = (code: string) => {
        if (form.required_skill_codes.includes(code)) {
            setForm({ ...form, required_skill_codes: form.required_skill_codes.filter(c => c !== code) });
        } else {
            setForm({ ...form, required_skill_codes: [...form.required_skill_codes, code] });
        }
    };

    // Materials editor
    const addMaterial = () => {
        setForm({
            ...form,
            default_materials: [...form.default_materials, { name: '', quantity: 1, unit: 'un' }],
        });
    };

    const updateMaterial = (index: number, field: keyof Material, value: string | number) => {
        const updated = [...form.default_materials];
        updated[index] = { ...updated[index], [field]: value };
        setForm({ ...form, default_materials: updated });
    };

    const removeMaterial = (index: number) => {
        setForm({
            ...form,
            default_materials: form.default_materials.filter((_, i) => i !== index),
        });
    };

    return (
        <AppLayout>
            <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <FileText className="h-6 w-6" />
                        Templates de Atividade
                    </h1>
                    <Button onClick={() => openModal()}>
                        <Plus className="h-4 w-4 mr-1" />
                        Novo Template
                    </Button>
                </div>

                {/* Filters */}
                <div className="flex gap-4">
                    <div>
                        <Label>Categoria</Label>
                        <Select value={filterCategory} onValueChange={setFilterCategory}>
                            <SelectTrigger className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas</SelectItem>
                                {CATEGORIES.map(c => (
                                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label>Status</Label>
                        <Select value={filterActive} onValueChange={setFilterActive}>
                            <SelectTrigger className="w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos</SelectItem>
                                <SelectItem value="active">Ativos</SelectItem>
                                <SelectItem value="inactive">Inativos</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Grid */}
                <Card>
                    <CardContent className="pt-6">
                        {loading ? (
                            <p className="text-muted-foreground">Carregando...</p>
                        ) : filteredTemplates.length === 0 ? (
                            <p className="text-muted-foreground">Nenhum template encontrado</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="text-left p-2">Categoria</th>
                                            <th className="text-left p-2">Título</th>
                                            <th className="text-left p-2">Duração</th>
                                            <th className="text-left p-2">Pessoas</th>
                                            <th className="text-left p-2">Skills</th>
                                            <th className="text-left p-2">Ativo</th>
                                            <th className="text-right p-2">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredTemplates.map((t) => (
                                            <tr key={t.id} className="border-b hover:bg-muted/50">
                                                <td className="p-2">
                                                    <Badge variant="outline">
                                                        {categoryLabels[t.category] || t.category}
                                                    </Badge>
                                                </td>
                                                <td className="p-2 font-medium">{t.title}</td>
                                                <td className="p-2">{t.default_minutes} min</td>
                                                <td className="p-2">{t.required_people}</td>
                                                <td className="p-2">
                                                    <div className="flex flex-wrap gap-1">
                                                        {(t.required_skill_codes || []).map(code => (
                                                            <Badge key={code} variant="secondary" className="text-xs">
                                                                {code}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="p-2">
                                                    <Badge variant={t.active ? 'default' : 'secondary'}>
                                                        {t.active ? 'Sim' : 'Não'}
                                                    </Badge>
                                                </td>
                                                <td className="p-2 text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => openModal(t)}
                                                        title="Editar"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => openModal(t, true)}
                                                        title="Duplicar"
                                                    >
                                                        <Copy className="h-4 w-4" />
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Modal */}
                <Dialog open={showModal} onOpenChange={setShowModal}>
                    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>
                                {editingTemplate ? 'Editar Template' : 'Novo Template'}
                            </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Categoria</Label>
                                    <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {CATEGORIES.map(c => (
                                                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex items-center gap-2 pt-6">
                                    <Switch
                                        checked={form.active}
                                        onCheckedChange={(checked) => setForm({ ...form, active: checked })}
                                    />
                                    <Label>Ativo</Label>
                                </div>
                            </div>

                            <div>
                                <Label>Título</Label>
                                <Input
                                    value={form.title}
                                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                                    placeholder="Ex: Portão sem funcionar"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Duração (min)</Label>
                                    <Input
                                        type="number"
                                        min={15}
                                        max={480}
                                        value={form.default_minutes}
                                        onChange={(e) => setForm({ ...form, default_minutes: parseInt(e.target.value) || 60 })}
                                    />
                                </div>
                                <div>
                                    <Label>Pessoas</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={4}
                                        value={form.required_people}
                                        onChange={(e) => setForm({ ...form, required_people: parseInt(e.target.value) || 1 })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Criticidade</Label>
                                    <Select
                                        value={form.criticality}
                                        onValueChange={(v) => setForm({
                                            ...form,
                                            criticality: v,
                                            sla_business_days: v === 'critical' ? 0 : 2
                                        })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="critical">Crítico (mesmo dia)</SelectItem>
                                            <SelectItem value="non_critical">Não Crítico (2 dias úteis)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label>SLA (dias úteis)</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        max={10}
                                        value={form.sla_business_days}
                                        onChange={(e) => setForm({ ...form, sla_business_days: parseInt(e.target.value) || 0 })}
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        0 = mesmo dia, 2 = 2 dias úteis
                                    </p>
                                </div>
                            </div>

                            <div>
                                <Label>Skills Exigidas</Label>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {skills.map(skill => (
                                        <Badge
                                            key={skill.code}
                                            variant={form.required_skill_codes.includes(skill.code) ? 'default' : 'outline'}
                                            className="cursor-pointer"
                                            onClick={() => toggleSkillCode(skill.code)}
                                        >
                                            {skill.code}
                                        </Badge>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between">
                                    <Label>Materiais Padrão</Label>
                                    <Button variant="outline" size="sm" onClick={addMaterial}>
                                        <Plus className="h-3 w-3 mr-1" />
                                        Adicionar
                                    </Button>
                                </div>
                                <div className="space-y-2 mt-2">
                                    {form.default_materials.map((mat, idx) => (
                                        <div key={idx} className="flex gap-2 items-center">
                                            <Input
                                                placeholder="Nome"
                                                value={mat.name}
                                                onChange={(e) => updateMaterial(idx, 'name', e.target.value)}
                                                className="flex-1"
                                            />
                                            <Input
                                                type="number"
                                                min={1}
                                                value={mat.quantity}
                                                onChange={(e) => updateMaterial(idx, 'quantity', parseInt(e.target.value) || 1)}
                                                className="w-20"
                                            />
                                            <Input
                                                placeholder="un"
                                                value={mat.unit}
                                                onChange={(e) => updateMaterial(idx, 'unit', e.target.value)}
                                                className="w-16"
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => removeMaterial(idx)}
                                            >
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setShowModal(false)}>
                                Cancelar
                            </Button>
                            <Button onClick={saveTemplate}>
                                <Save className="h-4 w-4 mr-1" />
                                Salvar
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </AppLayout>
    );
}
