import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Regex patterns to detect resolution messages
const RESOLUTION_PATTERNS = [
  // G7-202512-0003-ABC - Resolvido (new format with suffix)
  /(G7-\d{6}-\d{4}-[A-Z0-9]{3})\s*[-–—]?\ s*resolvido/i,
  // 202512-0003-ABC - Resolvido (new format with suffix)
  /(\d{6}-\d{4}-[A-Z0-9]{3})\s*[-–—]?\s*resolvido/i,
  // G7-20251223-0005 - Resolvido (old format, 8 digits)
  /(G7-\d{8}-\d{4,})\s*[-–—]?\s*resolvido/i,
  // Protocolo G7-202512-0003-ABC Resolvido
  /protocolo[:\s]*(G7-\d{6}-\d{4}-[A-Z0-9]{3}).*resolvido/i,
  // Protocolo 202512-0003-ABC Resolvido
  /protocolo[:\s]*(\d{6}-\d{4}-[A-Z0-9]{3}).*resolvido/i,
  // 202512-0007 - Resolvido (YYYYMM-NNNN format without suffix, for backwards compatibility)
  /(\d{6}-\d{4,})\s*[-–—]?\s*resolvido/i,
  // Protocolo 202512-0007 Resolvido
  /protocolo[:\s]*(\d{6}-\d{4,}).*resolvido/i,
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      message_content,
      participant_phone,
      participant_name,
      group_id,
      message_id,
    } = await req.json();

    console.log('Group resolution check:', { message_content, participant_phone, group_id });

    if (!message_content) {
      return new Response(JSON.stringify({ success: false, reason: 'No message content' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Try to match resolution pattern
    let protocolCode: string | null = null;
    for (const pattern of RESOLUTION_PATTERNS) {
      const match = message_content.match(pattern);
      if (match && match[1]) {
        protocolCode = match[1].toUpperCase();
        break;
      }
    }

    if (!protocolCode) {
      console.log('No protocol resolution pattern matched');
      return new Response(JSON.stringify({ success: false, reason: 'No resolution pattern matched' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Protocol code detected:', protocolCode);

    // Check agent permissions
    const normalizedPhone = participant_phone?.replace(/\D/g, '') || null;
    let agentRecord = null;
    let canClose = false;

    if (normalizedPhone) {
      const { data: agent } = await supabase
        .from('agents')
        .select('*')
        .eq('phone', normalizedPhone)
        .eq('is_active', true)
        .maybeSingle();

      agentRecord = agent;
      canClose = agent?.can_close_protocols === true;
    }

    // Get integration settings to send response
    const { data: settings } = await supabase
      .from('integrations_settings')
      .select('whatsapp_group_id')
      .limit(1)
      .single();

    const targetGroupId = group_id || settings?.whatsapp_group_id;

    // Helper function to send WhatsApp message
    async function sendGroupMessage(message: string): Promise<void> {
      if (!targetGroupId) return;

      try {
        const zapiInstanceId = Deno.env.get('ZAPI_INSTANCE_ID');
        const zapiToken = Deno.env.get('ZAPI_TOKEN');

        if (zapiInstanceId && zapiToken) {
          const zapiUrl = `https://api.z-api.io/instances/${zapiInstanceId}/token/${zapiToken}/send-text`;
          await fetch(zapiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: targetGroupId,
              message,
            }),
          });
        }
      } catch (err) {
        console.error('Error sending group message:', err);
      }
    }

    if (!canClose) {
      console.log('Agent not authorized to close protocols:', normalizedPhone);
      await sendGroupMessage(`⚠️ Apenas técnicos autorizados podem encerrar protocolos.

Telefone não autorizado: ${participant_phone || 'Desconhecido'}`);

      return new Response(JSON.stringify({
        success: false,
        reason: 'Not authorized',
        phone: normalizedPhone,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find protocol
    const { data: protocol, error: protocolError } = await supabase
      .from('protocols')
      .select('*')
      .eq('protocol_code', protocolCode)
      .maybeSingle();

    if (protocolError || !protocol) {
      console.log('Protocol not found:', protocolCode);
      await sendGroupMessage(`❌ Protocolo ${protocolCode} não encontrado no sistema.`);

      return new Response(JSON.stringify({
        success: false,
        reason: 'Protocol not found',
        protocol_code: protocolCode,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if already resolved (idempotency)
    if (protocol.status === 'resolved') {
      console.log('Protocol already resolved:', protocolCode);
      await sendGroupMessage(`ℹ️ Protocolo ${protocolCode} já estava resolvido anteriormente.`);

      return new Response(JSON.stringify({
        success: true,
        already_resolved: true,
        protocol_code: protocolCode,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========== 1. Update protocol status ==========
    const resolverName = agentRecord?.name || participant_name || 'Desconhecido';

    const { error: updateError } = await supabase
      .from('protocols')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by_agent_id: agentRecord?.id || null,
        resolved_by_name: resolverName,
      })
      .eq('id', protocol.id);

    if (updateError) {
      console.error('Error updating protocol:', updateError);
      throw updateError;
    }

    console.log('Protocol resolved:', protocolCode, 'by', resolverName);

    // ========== 2. Mark Asana task as completed ==========
    let asanaCompleted = false;
    if (protocol.asana_task_gid) {
      try {
        const asanaToken = Deno.env.get('ASANA_ACCESS_TOKEN');

        if (asanaToken) {
          const asanaResponse = await fetch(`https://app.asana.com/api/1.0/tasks/${protocol.asana_task_gid}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${asanaToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              data: { completed: true },
            }),
          });

          if (asanaResponse.ok) {
            asanaCompleted = true;
            console.log('Asana task completed:', protocol.asana_task_gid);
          } else {
            const errorText = await asanaResponse.text();
            console.error('Asana API error:', asanaResponse.status, errorText);
          }
        }
      } catch (asanaError) {
        console.error('Error completing Asana task:', asanaError);
      }
    }

    // ========== 3. Update conversation if exists ==========
    if (protocol.conversation_id) {
      await supabase
        .from('conversations')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: agentRecord?.profile_id || null,
        })
        .eq('id', protocol.conversation_id);
    }

    // ========== 4. Send confirmation message to group ==========
    const asanaNote = asanaCompleted ? ' (Asana finalizado)' : '';
    console.log('Sending resolution confirmation to group:', targetGroupId);
    await sendGroupMessage(`✅ Protocolo *${protocolCode}* resolvido por *${resolverName}*${asanaNote}.`);

    // ========== 5. Notify original conversation (if exists) ==========
    if (protocol.conversation_id) {
      try {
        const { data: originalConv } = await supabase
          .from('conversations')
          .select('contact_id, contacts(phone, chat_lid)')
          .eq('id', protocol.conversation_id)
          .single();

        // deno-lint-ignore no-explicit-any
        const contactData = originalConv?.contacts as any;
        if (contactData) {
          const zapiInstanceId = Deno.env.get('ZAPI_INSTANCE_ID');
          const zapiToken = Deno.env.get('ZAPI_TOKEN');

          if (zapiInstanceId && zapiToken) {
            const contactIdentifier = contactData.chat_lid || contactData.phone;
            if (contactIdentifier) {
              const clientMessage = `✅ Seu chamado (Protocolo ${protocolCode}) foi resolvido! 

Agradecemos o contato. Se precisar de algo mais, é só enviar uma mensagem.`;

              const zapiUrl = `https://api.z-api.io/instances/${zapiInstanceId}/token/${zapiToken}/send-text`;
              await fetch(zapiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  phone: contactIdentifier,
                  message: clientMessage,
                }),
              });
              console.log('Notified original contact about resolution');
            }
          }
        }
      } catch (notifyError) {
        console.error('Error notifying original contact:', notifyError);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      protocol_code: protocolCode,
      protocol_id: protocol.id,
      resolved_by: resolverName,
      asana_completed: asanaCompleted,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Group resolution error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
