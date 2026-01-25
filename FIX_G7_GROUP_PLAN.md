# Fix G7 Serv Group Normalization - Implementation Plan

## Problem Summary

The G7 Serv WhatsApp group is appearing without a name and messages are not accessible due to:

1. **Inconsistent Group JID Normalization** - Groups are using phone number fallback when they shouldn't
2. **Thread Key Mismatch** - Multiple conversations created for the same group with different thread_keys
3. **Name Extraction Issues** - Group name not being properly extracted from webhook payload

## Root Causes (from zapi-webhook/index.ts)

### Issue 1: Phone Fallback for Groups (Line 262-265)
```typescript
let rawIdentity = isGroup
  ? pickFirst(rawChatId, normalizedPhone)  // ⚠️ PROBLEM: fallback to phone
  : (fromMe ? ... : ...);
```
**Impact**: Groups can get a phone-based identity instead of group JID

### Issue 2: Inconsistent Thread Key (Line 327-330)
```typescript
const finalThreadKey = isGroupChat
  ? `group:${normalizeGroupJid(rawChatId || canonicalChatIdFinal || canonicalChatId)}`
  : `dm:${contactId}`;
```
**Impact**: Thread key can vary based on which field has data first

### Issue 3: Weak Name Extraction (Line 304-314)
```typescript
if (isGroupChat) {
  chatName = payload.chatName || payload.contact?.name || 'Grupo sem nome';
}
```
**Impact**: Missing common fields where group name appears

## Implementation Plan

### Phase 1: Diagnostic (COMPLETED ✓)

**File**: `DIAGNOSE_G7_GROUP.sql`

- Identify all conversations related to G7 Serv
- Find duplicate conversations for the same group
- Check thread_key and chat_id consistency
- Analyze contact aliases

**Action Required**: Run queries in Supabase SQL Editor and record:
- Conversation IDs found
- Contact IDs found
- Current thread_key values
- Message counts per conversation

---

### Phase 2: Webhook Fix

**File**: `supabase/functions/zapi-webhook/index.ts`

#### Change 1: Remove Phone Fallback for Groups
```typescript
// BEFORE (Line ~262)
let rawIdentity = isGroup
  ? pickFirst(rawChatId, normalizedPhone)  // ❌ BAD
  : ...;

// AFTER
let rawIdentity = isGroup
  ? rawChatId  // ✅ ONLY use chatId for groups
  : ...;
```

#### Change 2: Strict Group JID Normalization
```typescript
// Add after line 210 (after normalizeGroupJid function)
function strictNormalizeGroupJid(input: string): string | null {
  if (!input) return null;
  
  // Remove prefixes
  const cleaned = input.replace(/^(u:|g:)/, '').trim().toLowerCase();
  
  // Extract base (before @)
  const base = cleaned.includes('@') ? cleaned.split('@')[0] : cleaned;
  
  // Remove -group suffix if present
  const normalized = base.endsWith('-group') ? base.slice(0, -6) : base;
  
  // Always return with @g.us
  return `${normalized}@g.us`;
}
```

#### Change 3: Consistent Thread Key
```typescript
// BEFORE (Line ~327)
const finalThreadKey = isGroupChat
  ? `group:${normalizeGroupJid(rawChatId || canonicalChatIdFinal || canonicalChatId)}`
  : `dm:${contactId}`;

// AFTER
const finalThreadKey = isGroupChat
  ? `group:${strictNormalizeGroupJid(canonicalChatIdFinal)}` // Use ONLY canonicalChatIdFinal
  : `dm:${contactId}`;
```

#### Change 4: Enhanced Name Extraction
```typescript
// BEFORE (Line ~304)
let chatName: string;
if (isGroupChat) {
  chatName = payload.chatName || payload.contact?.name || 'Grupo sem nome';
}

// AFTER
let chatName: string;
if (isGroupChat) {
  // Try multiple sources for group name
  chatName = 
    payload.chatName || 
    payload.contact?.name || 
    payload.groupName ||
    payload.chat?.name ||
    payload.group?.subject ||
    payload.subject ||
    'Grupo sem nome';
  
  console.log(`[Webhook] Group name resolved: ${chatName}`);
}
```

#### Change 5: Add Group Debug Logging
```typescript
// Add after line 300 (before name extraction)
if (isGroupChat) {
  console.log('[Webhook] 👥 GROUP DETECTED:', {
    rawChatId,
    canonicalChatIdFinal,
    normalizedPhone,
    payloadChatName: payload.chatName,
    payloadContactName: payload.contact?.name,
    payloadGroupName: payload.groupName,
  });
}
```

---

### Phase 3: Data Repair

**File**: `FIX_G7_DUPLICATES.sql`

#### Prerequisites
- Results from DIAGNOSE_G7_GROUP.sql
- Identified canonical conversation ID (the one to keep)
- List of duplicate conversation IDs (to merge)

#### Steps:

1. **Identify Canonical Conversation**
   - Choose the one with most messages
   - OR the one with correct thread_key format (`group:<jid>@g.us`)
   - OR the oldest one

2. **Merge Messages**
   ```sql
   -- Move all messages to canonical conversation
   UPDATE messages 
   SET conversation_id = '<canonical_conv_id>'
   WHERE conversation_id IN ('<dup_id_1>', '<dup_id_2>', ...);
   ```

3. **Merge Protocols**
   ```sql
   -- Move all protocols to canonical conversation
   UPDATE protocols 
   SET conversation_id = '<canonical_conv_id>'
   WHERE conversation_id IN ('<dup_id_1>', '<dup_id_2>', ...);
   ```

4. **Normalize Canonical Conversation**
   ```sql
   -- Update thread_key and chat_id to correct format
   UPDATE conversations
   SET 
     thread_key = 'group:<correct_jid>@g.us',
     chat_id = '<correct_jid>@g.us',
     updated_at = NOW()
   WHERE id = '<canonical_conv_id>';
   ```

5. **Delete Duplicates**
   ```sql
   -- Only after messages and protocols are merged!
   DELETE FROM conversations
   WHERE id IN ('<dup_id_1>', '<dup_id_2>', ...);
   ```

6. **Update Contact Name**
   ```sql
   -- Ensure contact has correct name
   UPDATE contacts
   SET name = 'G7 Serv'
   WHERE id = '<contact_id>';
   ```

---

### Phase 4: Verification

#### Webhook Verification
1. Deploy updated webhook
2. Send test message to G7 Serv group
3. Check logs for:
   ```
   [Webhook] 👥 GROUP DETECTED: {...}
   [Webhook] Group name resolved: G7 Serv
   [Webhook] ✅ Contato resolvido: <contact_id> (chat_key: group:<jid>@g.us)
   ```

#### Database Verification
```sql
-- Should return ONLY ONE conversation for G7 Serv
SELECT 
  c.id,
  c.thread_key,
  c.chat_id,
  co.name,
  COUNT(m.id) as message_count
FROM conversations c
JOIN contacts co ON c.contact_id = co.id
LEFT JOIN messages m ON m.conversation_id = c.id
WHERE co.name ILIKE '%G7%Serv%'
GROUP BY c.id, c.thread_key, c.chat_id, co.name;
```

#### UI Verification
1. Open Wappal Connect inbox
2. Find "G7 Serv" conversation
3. Verify:
   - Name displays correctly
   - All messages are visible
   - Can send/receive messages
   - Thread key in URL is consistent

---

## Safety Measures

### Preventing Duplicates
1. **Unique Constraint**: Database already has `conversations_thread_key_key` unique index
2. **Atomic Upsert**: Webhook uses `upsert` with `onConflict: "thread_key"`
3. **Idempotent Message Insert**: Uses `provider_message_id` unique constraint

### Respecting LID Rules
1. **Never Convert LID to Phone**: Webhook preserves LID format (`@lid`)
2. **Separate Group Logic**: Groups use `@g.us`, never phone-based JIDs
3. **Alias System**: RPC `resolve_contact_identity` maintains all aliases

### Rollback Plan
If something goes wrong:
```sql
-- Restore from backup (if taken before changes)
RESTORE TABLE conversations FROM BACKUP '<timestamp>';
RESTORE TABLE messages FROM BACKUP '<timestamp>';

-- OR manually revert changes
UPDATE conversations SET ... WHERE id IN (...);
```

---

## Execution Checklist

- [ ] **Phase 1**: Run DIAGNOSE_G7_GROUP.sql queries
- [ ] **Phase 1**: Record all IDs and current state
- [ ] **Phase 2**: Update zapi-webhook/index.ts with all 5 changes
- [ ] **Phase 2**: Test changes locally if possible
- [ ] **Phase 2**: Deploy webhook to Supabase
- [ ] **Phase 3**: Create FIX_G7_DUPLICATES.sql with actual IDs
- [ ] **Phase 3**: Review SQL before execution
- [ ] **Phase 3**: Take backup (optional but recommended)
- [ ] **Phase 3**: Execute repair SQL
- [ ] **Phase 4**: Send test message to G7 Serv
- [ ] **Phase 4**: Verify in logs
- [ ] **Phase 4**: Verify in database
- [ ] **Phase 4**: Verify in UI
- [ ] **Phase 4**: Monitor for 24h for regressions

---

## Timeline

- **Phase 1 (Diagnostic)**: 15 minutes
- **Phase 2 (Webhook Fix)**: 30 minutes + deploy
- **Phase 3 (Data Repair)**: 20 minutes
- **Phase 4 (Verification)**: 15 minutes

**Total**: ~1.5 hours

---

## Notes

- This fix applies to ALL groups, not just G7 Serv
- After deploy, monitor other group conversations for issues
- The `strictNormalizeGroupJid` function ensures consistency
- Enhanced logging helps debug future group issues
- Keep DIAGNOSE_G7_GROUP.sql for future diagnostics
