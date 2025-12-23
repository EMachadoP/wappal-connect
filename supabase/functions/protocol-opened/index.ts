import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ============== UTILITY FUNCTIONS ==============

// Title Case PT-BR: capitaliza palavras, mantém preposições em minúsculo
function titleCasePtBR(input: string): string {
  if (!input) return input;
  const keepLower = new Set(["de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas", "por", "para", "com"]);
  return input
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) => {
      if (index > 0 && keepLower.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

// Traduzir categoria para português
function translateCategory(category: string): string {
  const map: Record<string, string> = {
    'operational': 'Operacional',
    'support': 'Suporte',
    'financial': 'Financeiro',
    'commercial': 'Comercial',
    'admin': 'Administrativo',
  };
  return map[category] || 'Operacional';
}

// Traduzir prioridade para português
function translatePriority(priority: string): string {
  return priority === 'critical' ? 'Crítico' : 'Normal';
}

// Traduzir role para português
function translateRole(role: string): string {
  const map: Record<string, string> = {
    'porteiro': 'Porteiro',
    'sindico': 'Síndico',
    'síndico': 'Síndico',
    'administrador': 'Administrador',
    'morador': 'Morador',
    'fornecedor': 'Fornecedor',
  };
  return map[role?.toLowerCase()] || role || 'Não informada';
}

// Calculate next business day (skip weekends)
function getNextBusinessDay(date: Date, daysToAdd: number): Date {
  const result = new Date(date);
  let addedDays = 0;
  
  while (addedDays < daysToAdd) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay();
    // Skip Saturday (6) and Sunday (0)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      addedDays++;
    }
  }
  
  return result;
}

// Format date as YYYY-MM-DD for Asana
function formatDateForAsana(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Get today in YYYY-MM-DD
function getTodayForAsana(): string {
  return new Date().toISOString().split('T')[0];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const {
      protocol_id,
      protocol_code,
      priority,
      category,
      summary,
      condominium_name,
      requester_name,
      requester_role,
      conversation_id,
      contact_id,
      condominium_id,
      // Novos campos de auditoria
      created_by_type,
      created_by_agent_id,
      customer_text,
      ai_summary,
      participant_id,
    } = await req.json();

    console.log('Protocol opened:', { protocol_code, priority, category, condominium_name, requester_name });

    // Check if protocol already has Asana task (idempotency)
    const { data: existingProtocol } = await supabase
      .from('protocols')
      .select('id, asana_task_gid, whatsapp_group_message_id')
      .eq('protocol_code', protocol_code)
      .maybeSingle();

    if (existingProtocol?.asana_task_gid) {
      console.log('Protocol already has Asana task, skipping:', existingProtocol.asana_task_gid);
      return new Response(JSON.stringify({ 
        success: true, 
        skipped: true,
        asana_task_gid: existingProtocol.asana_task_gid 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get integration settings
    const { data: settings } = await supabase
      .from('integrations_settings')
      .select('*')
      .limit(1)
      .single();

    if (!settings) {
      console.log('No integration settings found');
      return new Response(JSON.stringify({ error: 'Integration settings not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let protocolId = protocol_id;
    let whatsappMessageId: string | null = null;
    let asanaTaskGid: string | null = null;

    // Formatar dados para exibição
    const formattedCondominiumName = titleCasePtBR(condominium_name) || 'Não identificado';
    const formattedRequesterName = requester_name || 'Não identificado';
    const formattedRequesterRole = translateRole(requester_role);
    const formattedCategory = translateCategory(category || 'operational');
    const formattedPriority = translatePriority(priority || 'normal');

    // Create protocol record if it doesn't exist
    if (!protocolId && !existingProtocol) {
      const insertData: Record<string, unknown> = {
        protocol_code,
        conversation_id,
        contact_id,
        condominium_id,
        status: 'open',
        priority: priority || 'normal',
        category: category || 'operational',
        summary,
        requester_name: formattedRequesterName,
        requester_role: formattedRequesterRole,
      };

      // Adicionar campos de auditoria se fornecidos
      if (created_by_type) insertData.created_by_type = created_by_type;
      if (created_by_agent_id) insertData.created_by_agent_id = created_by_agent_id;
      if (customer_text) insertData.customer_text = customer_text;
      if (ai_summary) insertData.ai_summary = ai_summary;
      if (participant_id) insertData.participant_id = participant_id;

      const { data: newProtocol, error: createError } = await supabase
        .from('protocols')
        .insert(insertData)
        .select()
        .single();

      if (createError) {
        console.error('Error creating protocol:', createError);
        throw createError;
      }
      protocolId = newProtocol.id;
      console.log('Created protocol:', protocolId);
    } else if (existingProtocol) {
      protocolId = existingProtocol.id;
    }

    // Calculate due date
    const now = new Date();
    const isCritical = priority === 'critical';
    const dueDate = isCritical ? getTodayForAsana() : formatDateForAsana(getNextBusinessDay(now, 1));
    
    console.log('Due date calculated:', dueDate, 'priority:', priority);

    // ========== 1. Send WhatsApp Group Message ==========
    if (settings.whatsapp_notifications_enabled && settings.whatsapp_group_id) {
      try {
        const zapiInstanceId = Deno.env.get('ZAPI_INSTANCE_ID');
        const zapiToken = Deno.env.get('ZAPI_TOKEN');

        if (zapiInstanceId && zapiToken) {
          const priorityEmoji = isCritical ? '🔴 CRÍTICO' : '🟢 Normal';
          const priorityText = isCritical ? 'Resolver HOJE' : `Resolver até ${dueDate}`;
          
          const whatsappMessage = `📋 *NOVO PROTOCOLO*

🔖 *Protocolo:* ${protocol_code}
🏢 *Condomínio:* ${formattedCondominiumName}
👤 *Solicitante:* ${formattedRequesterName}
📌 *Função:* ${formattedRequesterRole}
📂 *Categoria:* ${formattedCategory}

📝 *Resumo:*
${summary || 'Sem descrição'}

${priorityEmoji}
⏰ *Prazo:* ${priorityText}

━━━━━━━━━━━━━━━━━━━━
✅ Para encerrar, digite:
*${protocol_code} - Resolvido*
━━━━━━━━━━━━━━━━━━━━`;

          const zapiUrl = `https://api.z-api.io/instances/${zapiInstanceId}/token/${zapiToken}/send-text`;
          
          const response = await fetch(zapiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: settings.whatsapp_group_id,
              message: whatsappMessage,
            }),
          });

          const zapiResult = await response.json();
          console.log('WhatsApp message sent:', zapiResult);
          
          if (zapiResult.zapiMessageId || zapiResult.messageId) {
            whatsappMessageId = zapiResult.zapiMessageId || zapiResult.messageId;
          }
        } else {
          console.log('Z-API credentials not configured');
        }
      } catch (whatsappError) {
        console.error('Error sending WhatsApp message:', whatsappError);
        // Continue - don't fail the whole operation
      }
    }

    // ========== 2. Create Asana Task ==========
    if (settings.asana_enabled && settings.asana_project_id) {
      try {
        const asanaToken = Deno.env.get('ASANA_ACCESS_TOKEN');
        
        if (asanaToken) {
          // Determine section based on category
          let sectionId: string | null = null;
          switch (category) {
            case 'financial':
              sectionId = settings.asana_section_financeiro;
              break;
            case 'support':
              sectionId = settings.asana_section_support;
              break;
            case 'admin':
              sectionId = settings.asana_section_admin;
              break;
            case 'operational':
            default:
              sectionId = settings.asana_section_operacional;
              break;
          }

          // ===== TÍTULO PADRONIZADO =====
          // Formato: [G7-YYYYMMDD-NNNN] Nome do Condomínio
          const asanaTaskName = `[${protocol_code}] ${formattedCondominiumName}`;

          // ===== DESCRIÇÃO PADRONIZADA EM PORTUGUÊS =====
          const asanaNotes = `📋 Protocolo: ${protocol_code}
🏢 Condomínio: ${formattedCondominiumName}
👤 Solicitante: ${formattedRequesterName}
📌 Função: ${formattedRequesterRole}
📂 Categoria: ${formattedCategory}
⚡ Prioridade: ${formattedPriority}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Resumo do Chamado:
${summary || 'Sem descrição'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Para encerrar: "${protocol_code} - Resolvido"`;

          const taskData: Record<string, unknown> = {
            data: {
              name: asanaTaskName,
              notes: asanaNotes,
              due_on: dueDate,
              projects: [settings.asana_project_id],
            },
          };

          // Add to section if specified
          if (sectionId) {
            (taskData.data as Record<string, unknown>).memberships = [{
              project: settings.asana_project_id,
              section: sectionId,
            }];
          }

          console.log('Creating Asana task:', asanaTaskName);

          const asanaResponse = await fetch('https://app.asana.com/api/1.0/tasks', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${asanaToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(taskData),
          });

          if (!asanaResponse.ok) {
            const errorText = await asanaResponse.text();
            console.error('Asana API error:', asanaResponse.status, errorText);
          } else {
            const asanaResult = await asanaResponse.json();
            console.log('Asana task created:', asanaResult.data?.gid);
            asanaTaskGid = asanaResult.data?.gid;
          }
        } else {
          console.log('Asana token not configured');
        }
      } catch (asanaError) {
        console.error('Error creating Asana task:', asanaError);
        // Continue - don't fail the whole operation
      }
    }

    // ========== 3. Update Protocol with IDs ==========
    if (protocolId && (whatsappMessageId || asanaTaskGid)) {
      const updateData: Record<string, unknown> = {
        due_date: dueDate,
      };
      if (whatsappMessageId) updateData.whatsapp_group_message_id = whatsappMessageId;
      if (asanaTaskGid) updateData.asana_task_gid = asanaTaskGid;

      await supabase
        .from('protocols')
        .update(updateData)
        .eq('id', protocolId);
      
      console.log('Protocol updated with integration IDs');
    }

    return new Response(JSON.stringify({
      success: true,
      protocol_id: protocolId,
      protocol_code,
      whatsapp_message_id: whatsappMessageId,
      asana_task_gid: asanaTaskGid,
      due_date: dueDate,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Protocol opened error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
