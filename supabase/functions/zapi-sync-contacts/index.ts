import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const zapiInstanceId = Deno.env.get('ZAPI_INSTANCE_ID')!;
const zapiToken = Deno.env.get('ZAPI_TOKEN')!;
const zapiClientToken = Deno.env.get('ZAPI_CLIENT_TOKEN')!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting contact sync from Z-API...');

    // Z-API endpoint to get contacts
    const zapiBaseUrl = `https://api.z-api.io/instances/${zapiInstanceId}/token/${zapiToken}`;
    
    const contactsResponse = await fetch(`${zapiBaseUrl}/contacts`, {
      method: 'GET',
      headers: {
        'Client-Token': zapiClientToken,
      },
    });

    if (!contactsResponse.ok) {
      const errorText = await contactsResponse.text();
      console.error('Z-API contacts error:', errorText);
      return new Response(JSON.stringify({ error: 'Failed to fetch contacts from Z-API', details: errorText }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const zapiContacts = await contactsResponse.json();
    console.log(`Fetched ${zapiContacts.length || 0} contacts from Z-API`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const zapiContact of (zapiContacts || [])) {
      try {
        // Extract data from Z-API contact
        const phone = zapiContact.phone?.replace(/\D/g, '') || null;
        const lid = zapiContact.lid || null;
        const name = zapiContact.name || zapiContact.pushname || phone || lid || 'Contato Desconhecido';
        const profilePicture = zapiContact.profilePicture || zapiContact.imgUrl || null;

        // Skip if no identifier
        if (!phone && !lid) {
          skipped++;
          continue;
        }

        // Check if contact exists (by LID first, then phone)
        let existingContact = null;
        
        if (lid) {
          const { data } = await supabase
            .from('contacts')
            .select('*')
            .eq('lid', lid)
            .single();
          existingContact = data;
        }
        
        if (!existingContact && phone) {
          const { data } = await supabase
            .from('contacts')
            .select('*')
            .eq('phone', phone)
            .single();
          existingContact = data;
        }

        if (existingContact) {
          // Update existing contact
          const updates: Record<string, unknown> = {};
          
          if (lid && !existingContact.lid) {
            updates.lid = lid;
            updates.lid_source = 'zapi_sync';
            updates.lid_collected_at = new Date().toISOString();
          }
          if (phone && !existingContact.phone) {
            updates.phone = phone;
          }
          if (name && existingContact.name === 'Contato Desconhecido') {
            updates.name = name;
          }
          if (profilePicture && !existingContact.profile_picture_url) {
            updates.profile_picture_url = profilePicture;
          }

          if (Object.keys(updates).length > 0) {
            await supabase
              .from('contacts')
              .update(updates)
              .eq('id', existingContact.id);
            updated++;
          } else {
            skipped++;
          }
        } else {
          // Create new contact
          const { error } = await supabase
            .from('contacts')
            .insert({
              lid: lid,
              phone: phone,
              name: name,
              profile_picture_url: profilePicture,
              lid_source: lid ? 'zapi_sync' : null,
              lid_collected_at: lid ? new Date().toISOString() : null,
            });

          if (error) {
            console.error('Error creating contact:', error);
            skipped++;
          } else {
            created++;
          }
        }
      } catch (contactError) {
        console.error('Error processing contact:', contactError);
        skipped++;
      }
    }

    console.log(`Sync complete: ${created} created, ${updated} updated, ${skipped} skipped`);

    return new Response(JSON.stringify({ 
      success: true, 
      created,
      updated,
      skipped,
      total: zapiContacts?.length || 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Sync error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
