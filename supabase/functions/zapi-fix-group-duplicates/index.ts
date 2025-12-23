import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

function normalizeKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s ? s : null;
}

function extractGroupKeyFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  // Prefer stable sources
  return (
    normalizeKey(p.chatLid) ||
    normalizeKey(p.chatId) ||
    normalizeKey(p.phone) ||
    normalizeKey((p.reaction as any)?.referencedMessage?.phone) ||
    null
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user = userData.user;
    const { data: isAdmin, error: roleErr } = await supabaseAdmin.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });

    if (roleErr || !isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = Boolean((body as any)?.dryRun);
    const limit = Number((body as any)?.limit ?? 200);

    // 1) Find group conversations missing stable keys
    const { data: missingChatId, error: q1Err } = await supabaseAdmin
      .from("conversations")
      .select(
        "id, chat_id, created_at, contact_id, contacts!inner(id, is_group, chat_lid, name, group_name)"
      )
      .is("chat_id", null)
      .eq("contacts.is_group", true)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (q1Err) throw q1Err;

    const { data: missingContactKey, error: q2Err } = await supabaseAdmin
      .from("conversations")
      .select(
        "id, chat_id, created_at, contact_id, contacts!inner(id, is_group, chat_lid, name, group_name)"
      )
      .not("chat_id", "is", null)
      .eq("contacts.is_group", true)
      .is("contacts.chat_lid", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    // If q2Err happens (PostgREST join filter edge), we can proceed with q1 only.
    if (q2Err) {
      console.log("Warning: query missingContactKey failed, proceeding with missingChatId only:", q2Err);
    }

    const convsRaw = [...(missingChatId || []), ...((missingContactKey as any) || [])];
    const uniqueById = new Map<string, any>();
    for (const c of convsRaw) uniqueById.set(c.id, c);
    const convs = Array.from(uniqueById.values());

    console.log("zapi-fix-group-duplicates candidates:", convs.length);

    let normalized = 0;
    let skippedNoKey = 0;
    const byKey = new Map<string, { convId: string; created_at: string; contact_id: string }[]>();

    for (const conv of convs) {
      const contact = (conv as any).contacts;
      const contactChatLid = normalizeKey(contact?.chat_lid);
      const convChatId = normalizeKey((conv as any).chat_id);

      let groupKey = convChatId || contactChatLid;

      if (!groupKey) {
        const { data: msgs, error: mErr } = await supabaseAdmin
          .from("messages")
          .select("chat_id, raw_payload, sent_at")
          .eq("conversation_id", conv.id)
          .order("sent_at", { ascending: false })
          .limit(5);

        if (mErr) throw mErr;

        for (const m of msgs || []) {
          groupKey = normalizeKey(m.chat_id) || extractGroupKeyFromPayload(m.raw_payload) || null;
          if (groupKey) break;
        }
      }

      if (!groupKey) {
        skippedNoKey++;
        continue;
      }

      // Normalize contact + conversation keys
      if (!dryRun) {
        // Check if another conversation already has this chat_id
        if (!convChatId) {
          const { data: existingConv, error: findConvErr } = await supabaseAdmin
            .from("conversations")
            .select("id, created_at, contact_id")
            .eq("chat_id", groupKey)
            .maybeSingle();

          if (findConvErr) throw findConvErr;

          if (existingConv && existingConv.id !== conv.id) {
            // Another conversation already owns this chat_id - add to merge list
            const list = byKey.get(groupKey) || [];
            // Add both if not already there
            if (!list.find((x) => x.convId === existingConv.id)) {
              list.push({ convId: existingConv.id, created_at: existingConv.created_at, contact_id: existingConv.contact_id });
            }
            list.push({ convId: conv.id, created_at: conv.created_at, contact_id: conv.contact_id });
            byKey.set(groupKey, list);
            normalized++;
            continue; // Skip update, will be merged later
          }

          // No conflict, safe to update
          const { error: updConvErr } = await supabaseAdmin
            .from("conversations")
            .update({ chat_id: groupKey })
            .eq("id", conv.id);
          if (updConvErr) {
            if (updConvErr.code === "23505") {
              // Race condition: another conversation got this chat_id, add to merge
              const list = byKey.get(groupKey) || [];
              list.push({ convId: conv.id, created_at: conv.created_at, contact_id: conv.contact_id });
              byKey.set(groupKey, list);
              normalized++;
              continue;
            }
            throw updConvErr;
          }
        }

        if (!contactChatLid) {
          const { error: updContactErr } = await supabaseAdmin
            .from("contacts")
            .update({ chat_lid: groupKey, name: contact?.group_name || contact?.name || "Grupo" })
            .eq("id", conv.contact_id);

          if (updContactErr) {
            // If unique violation, reattach conversation to the already-normalized group contact.
            if (updContactErr.code === "23505") {
              const { data: existingContact, error: findErr } = await supabaseAdmin
                .from("contacts")
                .select("id")
                .eq("is_group", true)
                .eq("chat_lid", groupKey)
                .maybeSingle();
              if (findErr) throw findErr;
              if (existingContact?.id) {
                const { error: relinkErr } = await supabaseAdmin
                  .from("conversations")
                  .update({ contact_id: existingContact.id })
                  .eq("id", conv.id);
                if (relinkErr) throw relinkErr;
              }
            } else {
              throw updContactErr;
            }
          }
        }

        // Ensure messages get the same chat_id for easier diagnostics
        await supabaseAdmin
          .from("messages")
          .update({ chat_id: groupKey })
          .eq("conversation_id", conv.id)
          .is("chat_id", null);
      }

      normalized++;

      const list = byKey.get(groupKey) || [];
      list.push({ convId: conv.id, created_at: conv.created_at, contact_id: conv.contact_id });
      byKey.set(groupKey, list);
    }

    // 2) Merge duplicates by groupKey
    let mergedConversations = 0;
    let movedMessages = 0;

    for (const [groupKey, items] of byKey.entries()) {
      if (items.length <= 1) continue;

      // Choose primary as earliest created
      items.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const primary = items[0];
      const duplicates = items.slice(1);

      if (!dryRun) {
        for (const dup of duplicates) {
          const { data: updMsgs, error: moveErr } = await supabaseAdmin
            .from("messages")
            .update({ conversation_id: primary.convId, chat_id: groupKey })
            .eq("conversation_id", dup.convId)
            .select("id");

          if (moveErr) throw moveErr;
          movedMessages += updMsgs?.length || 0;

          await supabaseAdmin.from("ai_events").insert({
            conversation_id: primary.convId,
            event_type: "system",
            message: `🔗 Conversa de grupo mesclada automaticamente (${groupKey}). Mensagens movidas de ${dup.convId}.`,
            metadata: { merged_from: dup.convId, group_key: groupKey, merged_at: new Date().toISOString() },
          });

          const { error: delErr } = await supabaseAdmin
            .from("conversations")
            .delete()
            .eq("id", dup.convId);
          if (delErr) throw delErr;

          mergedConversations++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        candidates: convs.length,
        normalized,
        skippedNoKey,
        mergedConversations,
        movedMessages,
        groupsAffected: Array.from(byKey.keys()).length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("zapi-fix-group-duplicates error:", error);
    return new Response(JSON.stringify({ error: String((error as any)?.message || error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
