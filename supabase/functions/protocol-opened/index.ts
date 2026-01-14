import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Load secrets with guards to prevent boot errors
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("[protocol-opened] BOOT ERROR: Missing required secrets", {
    hasUrl: !!supabaseUrl,
    hasServiceKey: !!supabaseServiceKey
  });
}

// ============== UTILITY FUNCTIONS ==============

// Title Case PT-BR: capitaliza palavras, mantém preposições em minúsculo
function titleCasePtBR(input: string): string {
  if (!input) return input;
  const keepLower = new Set([
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "em",
    "no",
    "na",
    "nos",
    "nas",
    "por",
    "para",
    "com",
  ]);
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
    operational: "Operacional",
    support: "Suporte",
    financial: "Financeiro",
    commercial: "Comercial",
    admin: "Administrativo",
  };
  return map[category] || "Operacional";
}

// Traduzir prioridade para português
function translatePriority(priority: string): string {
  return priority === "critical" ? "Crítico" : "Normal";
}

// Traduzir role para português
function translateRole(role: string): string {
  const map: Record<string, string> = {
    porteiro: "Porteiro",
    sindico: "Síndico",
    síndico: "Síndico",
    administrador: "Administrador",
    morador: "Morador",
    fornecedor: "Fornecedor",
  };
  return map[role?.toLowerCase()] || role || "Não informada";
}

// Brazilian holidays 2026 (add more years as needed)
const HOLIDAYS_2026 = [
  '2026-01-01', // Ano Novo
  '2026-02-16', // Carnaval
  '2026-02-17', // Carnaval
  '2026-04-03', // Sexta-feira Santa
  '2026-04-21', // Tiradentes
  '2026-05-01', // Dia do Trabalho
  '2026-06-04', // Corpus Christi
  '2026-09-07', // Independência
  '2026-10-12', // Nossa Senhora Aparecida
  '2026-11-02', // Finados
  '2026-11-15', // Proclamação da República
  '2026-12-25', // Natal
];

// Check if date is a holiday
function isHoliday(date: Date): boolean {
  const dateStr = date.toISOString().split('T')[0];
  return HOLIDAYS_2026.includes(dateStr);
}

// Check if date is weekend
function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

// Get same day or next business day if weekend/holiday
function getBusinessDay(date: Date = new Date()): Date {
  const result = new Date(date);

  // Move to next day until we find a business day
  while (isWeekend(result) || isHoliday(result)) {
    result.setDate(result.getDate() + 1);
  }

  return result;
}

// Format date as YYYY-MM-DD for Asana
function formatDateForAsana(date: Date): string {
  return date.toISOString().split("T")[0];
}

// Get SLA message based on priority
function getSLAMessage(priority: string): string {
  const slaMessages = {
    critical: [
      "Vamos resolver isso hoje mesmo!",
      "Nossa equipe está priorizando seu atendimento para hoje.",
      "Atendimento urgente - resolveremos no mesmo dia.",
    ],
    high: [
      "Vamos resolver isso hoje mesmo!",
      "Nossa equipe está priorizando seu atendimento para hoje.",
      "Atendimento prioritário - resolveremos no mesmo dia.",
    ],
    normal: [
      "Daremos retorno em até 2 dias úteis.",
      "Você terá uma resposta em até 2 dias úteis.",
      "Resolveremos em até 2 dias úteis.",
    ],
    low: [
      "Daremos retorno em até 2 dias úteis.",
      "Você terá uma resposta em até 2 dias úteis.",
      "Atenderemos em até 2 dias úteis.",
    ],
  };

  const messages = slaMessages[priority] || slaMessages.normal;
  return messages[Math.floor(Math.random() * messages.length)];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { protocol_id, protocol_code, notify_group } = await req.json();

    console.log('Protocol opened DB-first:', { protocol_code });

    // DB-FIRST: Load all data from database
    const { data: protocolData } = await supabase
      .from('protocols')
      .select(`
        *,
        conversations (
          id,
          contact_id,
          condominium_id,
          condominiums (name),
          contacts (name, phone, chat_lid)
        )
      `)
      .eq('protocol_code', protocol_code)
      .maybeSingle();

    if (!protocolData) {
      console.error('Protocol not found:', protocol_code);
      return new Response(JSON.stringify({ error: 'Protocol not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Extract data with fallbacks
    const protocol = protocolData;
    const conversation = (protocol.conversations as any) ?? {};
    const condominium = ((conversation.condominiums as any) ?? {}) as { name?: string };
    const contact = ((conversation.contacts as any) ?? {}) as { name?: string; phone?: string; chat_lid?: string };

    const formattedCondominiumName = titleCasePtBR(condominium.name) || "Não Identificado";
    const formattedRequesterName = protocol.requester_name || contact.name || "Não identificado";
    const formattedRequesterRole = translateRole(protocol.requester_role || 'morador');
    const formattedCategory = translateCategory(protocol.category || "operational");
    const formattedPriority = translatePriority(protocol.priority || "normal");
    const summary = protocol.summary || "Sem descrição";
    const conversation_id = conversation.id;
    const contact_id = conversation.contact_id;
    const condominium_id = conversation.condominium_id;
    const apartment = protocol.apartment;

    let protocolId = protocol.id;

    // Check if protocol already has Asana task (idempotency)
    if (protocol.asana_task_gid) {
      console.log("Protocol already has Asana task, skipping:", protocol.asana_task_gid);
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          asana_task_gid: protocol.asana_task_gid,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Get integration settings
    const { data: settings } = await supabase.from("integrations_settings").select("*").limit(1).single();

    if (!settings) {
      console.log("No integration settings found");
      return new Response(JSON.stringify({ error: "Integration settings not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let protocolId = protocol_id;
    let whatsappMessageId: string | null = null;
    let asanaTaskGid: string | null = null;

    // Formatar dados para exibição
    // Priorizar entity do participante, depois tentar extrair do summary
    let extractedCondominiumName = condominium_name;

    // 1. Tentar pegar do participante identificado
    if (participantEntity?.entities?.name) {
      extractedCondominiumName = participantEntity.entities.name;
      console.log('[Protocol] Using condominium from participant entity:', extractedCondominiumName);
    }
    // 2. Tratar string vazia como null e tentar extrair do summary
    else if (!extractedCondominiumName || extractedCondominiumName.trim() === '') {
      if (summary) {
        // Procurar padrões como "Condomínio X", "Cond. X", "Edifício X", "Ed. X"
        // Captura até encontrar ponto final ou fim de linha
        const condMatch = summary.match(/(?:Condomínio|Cond\.|Edifício|Ed\.|Prédio)\s+([A-Za-zÀ-ÿ0-9\s]+?)(?:\.|$)/i);
        if (condMatch) {
          extractedCondominiumName = condMatch[1].trim();
          console.log('[Protocol] Extracted condominium name from summary:', extractedCondominiumName);
        }
      }
    }

    const formattedCondominiumName = titleCasePtBR(extractedCondominiumName) || "Não Identificado";
    const formattedRequesterName = requester_name || "Não identificado";
    const formattedRequesterRole = translateRole(requester_role);
    const formattedCategory = translateCategory(category || "operational");
    const formattedPriority = translatePriority(priority || "normal");

    // Create protocol record if it doesn't exist
    if (!protocolId && !existingProtocol) {
      const insertData: Record<string, unknown> = {
        protocol_code,
        conversation_id,
        contact_id,
        condominium_id,
        status: "open",
        priority: priority || "normal",
        category: category || "operational",
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
        .from("protocols")
        .insert(insertData)
        .select()
        .single();

      if (createError) {
        console.error("Error creating protocol:", createError);
        throw createError;
      }
      protocolId = newProtocol.id;
      console.log("Created protocol:", protocolId);
    } else if (existingProtocol) {
      protocolId = existingProtocol.id;
    }

    // Calculate due date - always same day or next business day if weekend/holiday
    const dueDate = formatDateForAsana(getBusinessDay(new Date()));

    console.log("Due date calculated:", dueDate, "priority:", priority);

    // ========== 1. Send WhatsApp Group Message ==========
    if (settings.whatsapp_notifications_enabled && settings.whatsapp_group_id) {
      try {
        const { data: zapiSettings } = await supabase.from('zapi_settings').select('*').limit(1).single();

        const zapiInstanceId = Deno.env.get("ZAPI_INSTANCE_ID") || zapiSettings?.zapi_instance_id;
        const zapiToken = Deno.env.get("ZAPI_TOKEN") || zapiSettings?.zapi_token;
        const zapiClientToken = Deno.env.get("ZAPI_CLIENT_TOKEN") || zapiSettings?.zapi_security_token;

        if (zapiInstanceId && zapiToken) {
          // Format date for display
          const displayDate = new Date().toLocaleDateString('pt-BR');
          const yearMonthDay = protocol_code.split('-')[0]; // Get YYYYMM from protocol code

          // Priority emoji for group message
          const priorityEmoji = priority === 'critical' || priority === 'high' ? '🔴 CRÍTICO' : '🟢 Normal';

          const whatsappMessage = `*G7 Serv | Abertura de Chamado*
📅 ${displayDate} | 🧾 Seq.: ${protocol_code}

✅ *Protocolo:* G7-${protocol_code}
🏢 *Condomínio:* ${formattedCondominiumName}
👤 *Solicitante:* ${formattedRequesterName}${formattedRequesterRole ? ` (${formattedRequesterRole})` : ''}
📝 *Resumo:* ${summary || "Sem descrição"}
${priorityEmoji} *Prioridade:* ${priority || 'normal'}
⏰ *Vencimento:* ${dueDate}

➡️ *Para encerrar, responda:*
G7-${protocol_code} - Resolvido`;

          const zapiUrl = `https://api.z-api.io/instances/${zapiInstanceId}/token/${zapiToken}/send-text`;

          const response = await fetch(zapiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Client-Token": zapiClientToken,
            },
            body: JSON.stringify({
              phone: settings.whatsapp_group_id,
              message: whatsappMessage,
            }),
          });

          const zapiResult = await response.json();
          console.log("WhatsApp group message sent:", zapiResult);

          if (zapiResult.zapiMessageId || zapiResult.messageId) {
            whatsappMessageId = zapiResult.zapiMessageId || zapiResult.messageId;
          }

          // ========== 1.5: Send Daily Pending Summary ==========
          // Query open protocols created TODAY only
          try {
            const now = new Date();
            const displayDateSummary = now.toLocaleDateString('pt-BR');

            // ISO date for today (YYYY-MM-DD)
            const todayISO = now.toISOString().split('T')[0];
            const todayStart = `${todayISO}T00:00:00.000Z`;
            const todayEnd = `${todayISO}T23:59:59.999Z`;

            console.log(`[Pending Summary] Querying protocols for ${todayISO}...`);

            const { data: openProtocols, error: protocolsError } = await supabase
              .from('protocols')
              .select(`
                protocol_code,
                summary,
                category,
                priority,
                condominium_id,
                condominiums (name)
              `)
              .eq('status', 'open')
              .gte('created_at', todayStart)
              .lte('created_at', todayEnd)
              .order('created_at', { ascending: true });

            console.log('[Pending Summary] Query result:', {
              error: protocolsError?.message,
              count: openProtocols?.length ?? 0
            });

            if (protocolsError) {
              console.error('[Pending Summary] Query error:', protocolsError);
            }

            if (openProtocols && openProtocols.length > 0) {
              // Group by condominium for better readability
              const criticalItems: string[] = [];
              const normalItems: string[] = [];

              for (const p of openProtocols) {
                // Resolution Order: 1. Linked Condo Name -> 2. Regex from Summary -> 3. Fallback
                let condoName = (p.condominiums as any)?.name;

                if (!condoName && p.summary) {
                  const condMatch = p.summary.match(/(?:Condomínio|Cond\.|Edifício|Ed\.|Prédio)\s+([A-Za-zÀ-ÿ0-9\s]+?)(?:\.|$)/i);
                  if (condMatch) {
                    condoName = condMatch[1].trim();
                  }
                }

                if (!condoName) condoName = 'Não identificado';

                // Truncate summary to max 40 chars for cleaner display
                const shortSummary = p.summary && p.summary.length > 40
                  ? p.summary.substring(0, 40) + '...'
                  : (p.summary || 'Sem descrição');

                const line = `• ${condoName} - ${shortSummary}`;

                if (p.priority === 'critical' || p.priority === 'high') {
                  criticalItems.push(`🔴 ${line}`);
                } else {
                  normalItems.push(`🟢 ${line}`);
                }
              }

              // Build the summary message
              let summaryMessage = `📋 *${displayDateSummary} - Chamados do Dia*\n`;
              summaryMessage += `━━━━━━━━━━━━━━━━\n`;
              summaryMessage += `📊 *Total:* ${openProtocols.length} chamado(s) aberto(s) hoje\n\n`;

              if (criticalItems.length > 0) {
                summaryMessage += `⚠️ *CRÍTICOS (${criticalItems.length}):*\n`;
                summaryMessage += criticalItems.join('\n') + '\n\n';
              }

              if (normalItems.length > 0) {
                summaryMessage += `📌 *Normais (${normalItems.length}):*\n`;
                summaryMessage += normalItems.join('\n');
              }

              console.log('[Pending Summary] Sending message with', openProtocols.length, 'items');

              // Send the summary message to the group
              const summaryResponse = await fetch(zapiUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Client-Token": zapiClientToken,
                },
                body: JSON.stringify({
                  phone: settings.whatsapp_group_id,
                  message: summaryMessage,
                }),
              });

              const summaryResult = await summaryResponse.json();
              console.log('[Pending Summary] WhatsApp response:', summaryResult);
            } else {
              console.log('[Pending Summary] No open protocols found');
            }
          } catch (summaryError) {
            console.error('[Pending Summary] Error:', summaryError);
            // Don't fail the operation if summary fails
          }
        } else {
          console.log("Z-API credentials not configured (need ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN)");
        }
      } catch (whatsappError) {
        console.error("Error sending WhatsApp group message:", whatsappError);
        // Continue - don't fail the whole operation
      }
    }

    // ========== 2. Send WhatsApp message to client ==========
    if (conversation_id) {
      try {
        // Get SLA message based on priority
        const slaMessage = getSLAMessage(priority || 'normal');

        const clientMessage = `📋 *Protocolo aberto*

🔖 *Número:* G7-${protocol_code}
🏢 *Condomínio:* ${formattedCondominiumName}
📂 *Categoria:* ${formattedCategory}
📝 *Chamado:* ${summary || 'Sem descrição'}

${slaMessage}

O protocolo foi aberto em nosso sistema e o responsável fará a tratativa.`;

        const sendResult = await supabase.functions.invoke("zapi-send-message", {
          body: {
            conversation_id,
            content: clientMessage,
            message_type: "text",
            sender_name: "G7",
          },
        });

        console.log("Client message sent:", sendResult.data);
      } catch (clientMsgError) {
        console.error("Error sending client message:", clientMsgError);
        // Continue - don't fail the whole operation
      }
    }

    // ========== 2. Create Asana Task ==========
    if (settings.asana_enabled && settings.asana_project_id) {
      try {
        const asanaToken = Deno.env.get("ASANA_ACCESS_TOKEN");

        if (asanaToken) {
          // Determine section based on category
          let sectionId: string | null = null;
          switch (category) {
            case "financial":
              sectionId = settings.asana_section_financeiro;
              break;
            case "support":
              sectionId = settings.asana_section_support;
              break;
            case "admin":
              sectionId = settings.asana_section_admin;
              break;
            case "operational":
            default:
              sectionId = settings.asana_section_operacional;
              break;
          }

          // ===== TÍTULO PADRONIZADO =====
          // Formato: {Condomínio} - G7-{AAAAMM}-{SEQUÊNCIA}
          const asanaTaskName = `${formattedCondominiumName} - G7-${protocol_code}`;

          // ===== DESCRIÇÃO PADRONIZADA =====
          const asanaNotes = `**Resumo da IA:**
Condomínio: ${formattedCondominiumName}
Contato: ${apartment ? `Apto ${apartment}` : formattedRequesterName}
Problema: ${summary || 'Sem descrição'}

**Dados do Cliente:**
- Condomínio: ${formattedCondominiumName}
- Apartamento: ${apartment || 'Não informado'}
- Telefone: ${contact_id ? 'Registrado no sistema' : 'Não informado'}
- Solicitante: ${formattedRequesterName}${formattedRequesterRole ? ` (${formattedRequesterRole})` : ''}
- Horário: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}

**Prioridade:** ${priority || 'normal'}`;

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
            (taskData.data as Record<string, unknown>).memberships = [
              {
                project: settings.asana_project_id,
                section: sectionId,
              },
            ];
          }

          console.log("Creating Asana task:", asanaTaskName);

          const asanaResponse = await fetch("https://app.asana.com/api/1.0/tasks", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${asanaToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(taskData),
          });

          if (!asanaResponse.ok) {
            const errorText = await asanaResponse.text();
            console.error("Asana API error:", asanaResponse.status, errorText);
          } else {
            const asanaResult = await asanaResponse.json();
            console.log("Asana task created:", asanaResult.data?.gid);
            asanaTaskGid = asanaResult.data?.gid;
          }
        } else {
          console.log("Asana token not configured");
        }
      } catch (asanaError) {
        console.error("Error creating Asana task:", asanaError);
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

      await supabase.from("protocols").update(updateData).eq("id", protocolId);

      console.log("Protocol updated with integration IDs");
    }

    return new Response(
      JSON.stringify({
        success: true,
        protocol_id: protocolId,
        protocol_code,
        whatsapp_message_id: whatsappMessageId,
        asana_task_gid: asanaTaskGid,
        due_date: dueDate,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Protocol opened error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
