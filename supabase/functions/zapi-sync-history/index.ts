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
    const maxPages = body.maxPages || 10;

    let allChats: ZAPIChat[] = [];
    let currentPage = 1;
    let hasMore = true;

    console.log('Starting chat sync from Z-API...');

    // Fetch all chats with pagination
    while (hasMore && currentPage <= maxPages) {
      const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/chats?page=${currentPage}&pageSize=${pageSize}`;
      
      console.log(`Fetching page ${currentPage}...`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Client-Token': clientToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Z-API error on page ${currentPage}:`, errorText);
        break;
      }

      const chats: ZAPIChat[] = await response.json();
      
      if (!Array.isArray(chats) || chats.length === 0) {
        hasMore = false;
        break;
      }

      allChats = [...allChats, ...chats];
      console.log(`Fetched ${chats.length} chats from page ${currentPage}`);
      
      if (chats.length < pageSize) {
        hasMore = false;
      }
      
      currentPage++;
    }

    console.log(`Total chats fetched: ${allChats.length}`);

    let created = 0;
    let updated = 0;
    let errors = 0;

    // Process each chat
    for (const chat of allChats) {
      try {
        // Skip if no phone
        if (!chat.phone) {
          console.log('Skipping chat without phone');
          continue;
        }

        const isGroup = chat.isGroup || false;
        const contactName = chat.name || chat.phone;
        const phone = chat.phone;

        // Check if contact exists
        let { data: existingContact, error: contactFetchError } = await supabase
          .from('contacts')
          .select('id')
          .eq('phone', phone)
          .maybeSingle();

        if (contactFetchError) {
          console.error('Error fetching contact:', contactFetchError);
          errors++;
          continue;
        }

        let contactId: string;

        if (existingContact) {
          // Update existing contact
          const { error: updateError } = await supabase
            .from('contacts')
            .update({
              name: contactName,
              profile_picture_url: chat.profileThumbnail || null,
              is_group: isGroup,
              group_name: isGroup ? contactName : null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingContact.id);

          if (updateError) {
            console.error('Error updating contact:', updateError);
            errors++;
            continue;
          }

          contactId = existingContact.id;
          updated++;
        } else {
          // Create new contact
          const { data: newContact, error: insertError } = await supabase
            .from('contacts')
            .insert({
              phone: phone,
              name: contactName,
              profile_picture_url: chat.profileThumbnail || null,
              is_group: isGroup,
              group_name: isGroup ? contactName : null,
            })
            .select('id')
            .single();

          if (insertError || !newContact) {
            console.error('Error creating contact:', insertError);
            errors++;
            continue;
          }

          contactId = newContact.id;
          created++;
        }

        // Check if conversation exists for this contact
        const { data: existingConversation } = await supabase
          .from('conversations')
          .select('id')
          .eq('contact_id', contactId)
          .maybeSingle();

        if (!existingConversation) {
          // Create conversation
          const lastMessageAt = chat.lastMessageTime 
            ? new Date(parseInt(chat.lastMessageTime) * 1000).toISOString()
            : new Date().toISOString();

          const { error: convError } = await supabase
            .from('conversations')
            .insert({
              contact_id: contactId,
              status: 'open',
              unread_count: parseInt(chat.unread) || 0,
              last_message_at: lastMessageAt,
            });

          if (convError) {
            console.error('Error creating conversation:', convError);
            errors++;
          }
        } else {
          // Update conversation with unread count
          const lastMessageAt = chat.lastMessageTime 
            ? new Date(parseInt(chat.lastMessageTime) * 1000).toISOString()
            : null;

          const updateData: Record<string, unknown> = {
            unread_count: parseInt(chat.unread) || 0,
            updated_at: new Date().toISOString(),
          };

          if (lastMessageAt) {
            updateData.last_message_at = lastMessageAt;
          }

          await supabase
            .from('conversations')
            .update(updateData)
            .eq('id', existingConversation.id);
        }

      } catch (chatError) {
        console.error('Error processing chat:', chatError);
        errors++;
      }
    }

    const result = {
      success: true,
      totalChats: allChats.length,
      created,
      updated,
      errors,
      message: `Sincronização concluída: ${created} novos, ${updated} atualizados, ${errors} erros`,
    };

    console.log('Sync completed:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in sync history:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
