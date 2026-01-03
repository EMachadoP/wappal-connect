import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { messageId, mediaUrl, mediaType } = await req.json();

        if (!messageId || !mediaUrl || !mediaType) {
            throw new Error('Missing required parameters: messageId, mediaUrl, mediaType');
        }

        console.log(`[Media Storage] Processing ${mediaType} for message ${messageId}`);
        console.log(`[Media Storage] Original URL: ${mediaUrl}`);

        // 1. Download media from Z-API
        const mediaResponse = await fetch(mediaUrl);
        if (!mediaResponse.ok) {
            throw new Error(`Failed to download media: ${mediaResponse.statusText}`);
        }

        const mediaBlob = await mediaResponse.blob();
        console.log(`[Media Storage] Downloaded ${mediaBlob.size} bytes`);

        // 2. Determine file extension and content type
        let extension = 'bin';
        let contentType = 'application/octet-stream';

        if (mediaType === 'audio') {
            extension = 'ogg';
            contentType = 'audio/ogg';
        } else if (mediaType === 'video') {
            extension = 'mp4';
            contentType = 'video/mp4';
        }

        // 3. Generate filename
        const filename = `${mediaType}/${messageId}_${Date.now()}.${extension}`;

        // 4. Upload to Supabase Storage
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('media-files')
            .upload(filename, mediaBlob, {
                contentType: contentType,
                cacheControl: '31536000', // 1 year
                upsert: false,
            });

        if (uploadError) {
            console.error('[Media Storage] Upload error:', uploadError);
            throw uploadError;
        }

        console.log(`[Media Storage] Uploaded to: ${filename}`);

        // 5. Get public URL
        const { data: { publicUrl } } = supabase.storage
            .from('media-files')
            .getPublicUrl(filename);

        console.log(`[Media Storage] Public URL: ${publicUrl}`);

        // 6. Update message with new URL
        const { error: updateError } = await supabase
            .from('messages')
            .update({ media_url: publicUrl })
            .eq('id', messageId);

        if (updateError) {
            console.error('[Media Storage] Update error:', updateError);
            throw updateError;
        }

        console.log(`[Media Storage] Successfully stored ${mediaType} for message ${messageId}`);

        return new Response(
            JSON.stringify({
                success: true,
                publicUrl,
                filename,
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        );

    } catch (error: any) {
        console.error('[Media Storage] Error:', error);
        return new Response(
            JSON.stringify({
                success: false,
                error: error.message
            }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        );
    }
});
