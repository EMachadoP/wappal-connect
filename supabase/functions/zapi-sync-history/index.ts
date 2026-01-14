import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ZAPIChat {
  phone: string;
  name: string;
  profileThumbnail?: string;
  isGroup: boolean;
  lastMessageTime: string;
  unread: string;
  archived: string;
  pinned: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID');
    const token = Deno.env.get('ZAPI_TOKEN');
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');

    if (!instanceId || !token || !clientToken) {
      console.error('Missing Z-API credentials');
      return new Response(
        JSON.stringify({ error: 'Missing Z-API credentials' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const pageSize = body.pageSize || 50;
    const maxPages = body.maxPages || 30;

    let allChats: ZAPIChat[] = [];
    let currentPage = 1;
    let hasMore = true;

    console.log('Starting chat sync from Z-API...');

    while (hasMore && currentPage <= maxPages) {
      const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/chats?page=${currentPage}&pageSize=${pageSize}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Client-Token': clientToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) break;

      const chats: ZAPIChat[] = await response.json();
      if (!Array.isArray(chats) || chats.length === 0) {
        hasMore = false;
        break;
      }

      allChats = [...allChats, ...chats];
      if (chats.length < pageSize) hasMore = false;
      currentPage++;
    }

    let created = 0;
    let updated = 0;
    let errors = 0;

    // --- HELPERS ---
    // Same normalization logic as zapi-webhook to ensure IDs match
    const normalizeLid = (id: string | null | undefined, isGroup: boolean) => {
      if (!id) return id;
      let normalized = id.trim().toLowerCase();

      // Preserve @lid and @g.us (LID identifiers)
      if (normalized.endsWith('@lid') || normalized.endsWith('@g.us')) {
        return normalized;
      }

      // Remove legacy suffixes only (@c.us, @s.whatsapp.net)
      // Only if not a group or if group but doesn't have @g.us
      if (!isGroup && normalized.includes('@')) {
        normalized = normalized.split('@')[0];
      }

      return normalized;
    };

    for (const chat of allChats) {
      try {
        if (!chat.phone) continue;

        const isGroup = chat.isGroup || false;

        // Normalize IDs immediately
        const rawPhone = chat.phone;
        const normalizedLid = normalizeLid(rawPhone, isGroup);

        if (!normalizedLid) continue;

        const contactName = chat.name || normalizedLid;
        const groupKey = isGroup ? normalizedLid : null;

        // Use normalized ID for phone field in contacts (to match webhook)
        const phone = normalizedLid;

        let existingContact: { id: string } | null = null;

        if (isGroup && groupKey) {
          const { data } = await supabase
            .from('contacts')
            .select('id')
            .eq('is_group', true)
            .eq('chat_lid', groupKey)
            .maybeSingle();
          existingContact = data;
        }

        if (!existingContact) {
          const { data } = await supabase
            .from('contacts')
            .select('id')
            .eq('phone', phone)
            .maybeSingle();
          existingContact = data;
        }

        let contactId: string;

        if (existingContact) {
          const updates: Record<string, unknown> = {
            name: contactName,
            profile_picture_url: chat.profileThumbnail || null,
            is_group: isGroup,
            group_name: isGroup ? contactName : null,
            updated_at: new Date().toISOString(),
          };

          if (isGroup && groupKey) {
            updates.chat_lid = groupKey;
          }

          await supabase.from('contacts').update(updates).eq('id', existingContact.id);
          contactId = existingContact.id;
          updated++;
        } else {
          const insertData: Record<string, unknown> = {
            phone: phone,
            name: contactName,
            profile_picture_url: chat.profileThumbnail || null,
            is_group: isGroup,
            group_name: isGroup ? contactName : null,
          };

          if (isGroup && groupKey) {
            insertData.chat_lid = groupKey;
          }

          const { data: newContact, error: insertError } = await supabase
            .from('contacts')
            .insert(insertData)
            .select('id')
            .single();

          if (insertError || !newContact) continue;
          contactId = newContact.id;
          created++;
        }

        // LÓGICA DE THREAD_KEY PADRONIZADA (Mesma do Webhook)
        const threadKey = isGroup ? groupKey : (phone || contactId);

        let existingConversation: { id: string } | null = null;

        if (threadKey) {
          const { data } = await supabase
            .from('conversations')
            .select('id')
            .eq('thread_key', threadKey)
            .maybeSingle();
          existingConversation = data;
        }

        const timestamp = parseInt(chat.lastMessageTime);
        const lastMessageAt = chat.lastMessageTime && timestamp > 0
          ? new Date(timestamp > 9999999999 ? timestamp : timestamp * 1000).toISOString()
          : new Date().toISOString();

        if (!existingConversation) {
          await supabase.from('conversations').insert({
            contact_id: contactId,
            chat_id: isGroup ? groupKey : phone,
            thread_key: threadKey,
            status: 'open',
            unread_count: parseInt(chat.unread) || 0,
            last_message_at: lastMessageAt,
          });
        } else {
          await supabase.from('conversations').update({
            unread_count: parseInt(chat.unread) || 0,
            last_message_at: lastMessageAt,
            updated_at: new Date().toISOString(),
            chat_id: isGroup ? groupKey : phone,
          }).eq('id', existingConversation.id);
        }

      } catch (err) {
        errors++;
      }
    }

    return new Response(JSON.stringify({ success: true, created, updated, errors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});