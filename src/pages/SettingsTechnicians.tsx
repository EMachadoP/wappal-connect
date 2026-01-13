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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Users,
    Wrench,
    Plus,
    Pencil,
    Trash2,
    Save,
    X,
} from 'lucide-react';
import { toast } from 'sonner';

interface Technician {
    id: string;
    name: string;
    is_active: boolean;
    created_at: string;
    skills: { code: string; label: string; level: number }[];
    dispatch_priority?: number;
}

interface Skill {
    id: string;
    code: string;
    label: string;
}

export default function SettingsTechnicians() {
    const [technicians, setTechnicians] = useState<Technician[]>([]);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('technicians');

    // Technician form
    const [showTechModal, setShowTechModal] = useState(false);
    const [editingTech, setEditingTech] = useState<Technician | null>(null);
    const [techForm, setTechForm] = useState({ name: '', is_active: true, dispatch_priority: 100 });
    const [techSkills, setTechSkills] = useState<{ skill_id: string; level: number }[]>([]);

    // Skill form
    const [showSkillModal, setShowSkillModal] = useState(false);
    const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
    const [skillForm, setSkillForm] = useState({ code: '', label: '' });

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch technicians with skills
            const { data: techData } = await supabase
                .from('technicians')
                .select(`
                    *,
                    technician_skills (
                        level,
                        skills (id, code, label)
                    )
                `)
                .order('name');

            const techs = (techData || []).map((t: any) => ({
                ...t,
                skills: (t.technician_skills || []).map((ts: any) => ({
                    code: ts.skills?.code,
                    label: ts.skills?.label,
                    level: ts.level,
                })),
            }));
            setTechnicians(techs);

            // Fetch all skills
            const { data: skillData } = await supabase
                .from('skills')
                .select('*')
                .order('code');
            setSkills(skillData || []);
        } catch (err) {
            console.error('Error fetching data:', err);
            toast.error('Erro ao carregar dados');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // --- Technician CRUD ---
    const openTechModal = (tech?: Technician) => {
        if (tech) {
            setEditingTech(tech);
            setTechForm({
                name: tech.name,
                is_active: tech.is_active,
                dispatch_priority: tech.dispatch_priority || 100
            });
            // Get current skills for this technician
            const currentSkills = tech.skills.map(s => {
                const skill = skills.find(sk => sk.code === s.code);
                return skill ? { skill_id: skill.id, level: s.level } : null;
            }).filter(Boolean) as { skill_id: string; level: number }[];
            setTechSkills(currentSkills);
        } else {
            setEditingTech(null);
            setTechForm({ name: '', is_active: true, dispatch_priority: 100 });
            setTechSkills([]);
        }
        setShowTechModal(true);
    };

    const saveTechnician = async () => {
        if (techForm.name.length < 3) {
            toast.error('Nome deve ter pelo menos 3 caracteres');
            return;
        }

        try {
            let techId = editingTech?.id;

            if (editingTech) {
                // Update
                const { error } = await supabase
                    .from('technicians')
                    .update({
                        name: techForm.name,
                        is_active: techForm.is_active,
                        dispatch_priority: techForm.dispatch_priority
                    })
                    .eq('id', techId);
                if (error) throw error;
            } else {
                // Insert
                const { data, error } = await supabase
                    .from('technicians')
                    .insert({
                        name: techForm.name,
                        is_active: techForm.is_active,
                        dispatch_priority: techForm.dispatch_priority
                    })
                    .select('id')
                    .single();
                if (error) throw error;
                techId = data.id;
            }

            // Update skills
            if (techId) {
                // Delete existing
                await supabase
                    .from('technician_skills')
                    .delete()
                    .eq('technician_id', techId);

                // Insert new
                if (techSkills.length > 0) {
                    await supabase
                        .from('technician_skills')
                        .insert(techSkills.map(ts => ({
                            technician_id: techId,
                            skill_id: ts.skill_id,
                            level: ts.level,
                        })));
                }
            }

            toast.success(editingTech ? 'Técnico atualizado!' : 'Técnico criado!');
            setShowTechModal(false);
            fetchData();
        } catch (err) {
            console.error('Error saving technician:', err);
            toast.error('Erro ao salvar técnico');
        }
    };

    const toggleTechSkill = (skillId: string) => {
        const exists = techSkills.find(ts => ts.skill_id === skillId);
        if (exists) {
            setTechSkills(techSkills.filter(ts => ts.skill_id !== skillId));
        } else {
            setTechSkills([...techSkills, { skill_id: skillId, level: 1 }]);
        }
    };

    const updateSkillLevel = (skillId: string, level: number) => {
        setTechSkills(techSkills.map(ts =>
            ts.skill_id === skillId ? { ...ts, level: Math.max(1, Math.min(5, level)) } : ts
        ));
    };

    // --- Skill CRUD ---
    const openSkillModal = (skill?: Skill) => {
        if (skill) {
            setEditingSkill(skill);
            setSkillForm({ code: skill.code, label: skill.label });
        } else {
            setEditingSkill(null);
            setSkillForm({ code: '', label: '' });
        }
        setShowSkillModal(true);
    };

    const saveSkill = async () => {
        const code = skillForm.code.toUpperCase().replace(/[^A-Z0-9_]/g, '');
        if (code.length < 2) {
            toast.error('Código deve ter pelo menos 2 caracteres (A-Z, 0-9, _)');
            return;
        }
        if (skillForm.label.length < 2) {
            toast.error('Label deve ter pelo menos 2 caracteres');
            return;
        }

        try {
            if (editingSkill) {
                const { error } = await supabase
                    .from('skills')
                    .update({ code, label: skillForm.label })
                    .eq('id', editingSkill.id);
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('skills')
                    .insert({ code, label: skillForm.label });
                if (error) throw error;
            }

            toast.success(editingSkill ? 'Skill atualizada!' : 'Skill criada!');
            setShowSkillModal(false);
            fetchData();
        } catch (err: any) {
            if (err.code === '23505') {
                toast.error('Código já existe');
            } else {
                toast.error('Erro ao salvar skill');
            }
        }
    };

    const deleteSkill = async (id: string) => {
        if (!confirm('Remover esta skill?')) return;
        try {
            await supabase.from('skills').delete().eq('id', id);
            toast.success('Skill removida');
            fetchData();
        } catch (err) {
            toast.error('Erro ao remover skill');
        }
    };

    return (
        <AppLayout>
            <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Users className="h-6 w-6" />
                        Técnicos & Skills
                    </h1>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList>
                        <TabsTrigger value="technicians">
                            <Users className="h-4 w-4 mr-1" />
                            Técnicos
                        </TabsTrigger>
                        <TabsTrigger value="skills">
                            <Wrench className="h-4 w-4 mr-1" />
                            Skills
                        </TabsTrigger>
                    </TabsList>

                    {/* Technicians Tab */}
                    <TabsContent value="technicians" className="mt-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle>Técnicos Cadastrados</CardTitle>
                                <Button onClick={() => openTechModal()}>
                                    <Plus className="h-4 w-4 mr-1" />
                                    Novo Técnico
                                </Button>
                            </CardHeader>
                            <CardContent>
                                {loading ? (
                                    <p className="text-muted-foreground">Carregando...</p>
                                ) : technicians.length === 0 ? (
                                    <p className="text-muted-foreground">Nenhum técnico cadastrado</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b">
                                                    <th className="text-left p-2">Nome</th>
                                                    <th className="text-left p-2">Ativo</th>
                                                    <th className="text-left p-2">Prioridade</th>
                                                    <th className="text-left p-2">Skills</th>
                                                    <th className="text-right p-2">Ações</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {technicians.map((tech) => (
                                                    <tr key={tech.id} className="border-b hover:bg-muted/50">
                                                        <td className="p-2 font-medium">{tech.name}</td>
                                                        <td className="p-2">
                                                            <Badge variant={tech.is_active ? 'default' : 'secondary'}>
                                                                {tech.is_active ? 'Sim' : 'Não'}
                                                            </Badge>
                                                        </td>
                                                        <td className="p-2">
                                                            <span className="text-sm font-mono">
                                                                {tech.dispatch_priority ?? 100}
                                                            </span>
                                                        </td>
                                                        <td className="p-2">
                                                            <div className="flex flex-wrap gap-1">
                                                                {tech.skills.map((s) => (
                                                                    <Badge key={s.code} variant="outline">
                                                                        {s.code} (Lv{s.level})
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        </td>
                                                        <td className="p-2 text-right">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => openTechModal(tech)}
                                                            >
                                                                <Pencil className="h-4 w-4" />
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
                    </TabsContent>

                    {/* Skills Tab */}
                    <TabsContent value="skills" className="mt-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle>Skills Disponíveis</CardTitle>
                                <Button onClick={() => openSkillModal()}>
                                    <Plus className="h-4 w-4 mr-1" />
                                    Nova Skill
                                </Button>
                            </CardHeader>
                            <CardContent>
                                {loading ? (
                                    <p className="text-muted-foreground">Carregando...</p>
                                ) : skills.length === 0 ? (
                                    <p className="text-muted-foreground">Nenhuma skill cadastrada</p>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {skills.map((skill) => (
                                            <div
                                                key={skill.id}
                                                className="flex items-center justify-between p-3 border rounded-lg"
                                            >
                                                <div>
                                                    <Badge variant="outline" className="font-mono">
                                                        {skill.code}
                                                    </Badge>
                                                    <span className="ml-2 text-sm">{skill.label}</span>
                                                </div>
                                                <div className="flex gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => openSkillModal(skill)}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => deleteSkill(skill.id)}
                                                    >
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>

                {/* Technician Modal */}
                <Dialog open={showTechModal} onOpenChange={setShowTechModal}>
                    <DialogContent className="max-w-md">
                        <DialogHeader>
                            <DialogTitle>
                                {editingTech ? 'Editar Técnico' : 'Novo Técnico'}
                            </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="tech-name">Nome</Label>
                                <Input
                                    id="tech-name"
                                    value={techForm.name}
                                    onChange={(e) => setTechForm({ ...techForm, name: e.target.value })}
                                    placeholder="Nome do técnico"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch
                                    checked={techForm.is_active}
                                    onCheckedChange={(checked) => setTechForm({ ...techForm, is_active: checked })}
                                />
                                <Label>Ativo</Label>
                            </div>
                            <div>
                                <Label htmlFor="tech-priority">Prioridade de Despacho (André Coringa = 300)</Label>
                                <Input
                                    id="tech-priority"
                                    type="number"
                                    value={techForm.dispatch_priority}
                                    onChange={(e) => setTechForm({ ...techForm, dispatch_priority: parseInt(e.target.value) || 100 })}
                                    placeholder="100 (Normal), 300 (Coringa)"
                                />
                                <p className="text-xs text-muted-foreground mt-1">Valores menores são priorizados na distribuição automática.</p>
                            </div>
                            <div>
                                <Label>Skills</Label>
                                <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                                    {skills.map((skill) => {
                                        const ts = techSkills.find(t => t.skill_id === skill.id);
                                        return (
                                            <div key={skill.id} className="flex items-center gap-2 p-2 border rounded">
                                                <Switch
                                                    checked={!!ts}
                                                    onCheckedChange={() => toggleTechSkill(skill.id)}
                                                />
                                                <span className="flex-1">{skill.code} - {skill.label}</span>
                                                {ts && (
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        max={5}
                                                        value={ts.level}
                                                        onChange={(e) => updateSkillLevel(skill.id, parseInt(e.target.value) || 1)}
                                                        className="w-16"
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setShowTechModal(false)}>
                                Cancelar
                            </Button>
                            <Button onClick={saveTechnician}>
                                <Save className="h-4 w-4 mr-1" />
                                Salvar
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Skill Modal */}
                <Dialog open={showSkillModal} onOpenChange={setShowSkillModal}>
                    <DialogContent className="max-w-sm">
                        <DialogHeader>
                            <DialogTitle>
                                {editingSkill ? 'Editar Skill' : 'Nova Skill'}
                            </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="skill-code">Código</Label>
                                <Input
                                    id="skill-code"
                                    value={skillForm.code}
                                    onChange={(e) => setSkillForm({ ...skillForm, code: e.target.value.toUpperCase() })}
                                    placeholder="Ex: PORTAO, CFTV"
                                    className="font-mono"
                                />
                                <p className="text-xs text-muted-foreground mt-1">Apenas letras, números e _</p>
                            </div>
                            <div>
                                <Label htmlFor="skill-label">Label</Label>
                                <Input
                                    id="skill-label"
                                    value={skillForm.label}
                                    onChange={(e) => setSkillForm({ ...skillForm, label: e.target.value })}
                                    placeholder="Ex: Motor de Portão"
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setShowSkillModal(false)}>
                                Cancelar
                            </Button>
                            <Button onClick={saveSkill}>
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
