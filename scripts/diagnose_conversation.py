
import os
import json
import urllib.request
import urllib.parse

SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co'
SUPABASE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD' # Temporary for diagnostic
TARGET_ID = '86852979679326'

def query_supabase(table, params):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}"
    req = urllib.request.Request(url)
    req.add_header('apikey', SUPABASE_KEY)
    req.add_header('Authorization', f"Bearer {SUPABASE_KEY}")
    req.add_header('Content-Type', 'application/json')
    
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error querying {table}: {e}")
        return None

def diagnose():
    print(f"🔍 Diagnosing conversation for ID fragment: {TARGET_ID}")
    
    # 1. Find conversations
    # Filter: thread_key.ilike.%ID%,chat_id.ilike.%ID%
    # Updated query format for PostgREST
    query = f"or=(thread_key.ilike.*{TARGET_ID}*,chat_id.ilike.*{TARGET_ID}*)&select=id,thread_key,chat_id,is_group,title,contact_id,updated_at&limit=20"
    
    convs = query_supabase('conversations', query)
    
    if not convs:
        print("❌ No conversations found matching this ID.")
        return

    print(f"\n📄 Found {len(convs)} conversations:")
    
    for conv in convs:
        cid = conv.get('id')
        
        # Count messages
        # select=*,head=true&count=exact equivalent not directly simple in one go with stdlib for count mostly headers
        # We'll just fetch id with count=exact header preference if possible, or just fetch count
        # PostgREST: select=id&conversation_id=eq.ID
        # To get count we check Content-Range header usually, but simple requests might not expose it easily in urllib.
        # Let's just fetch length of ids.
        
        msg_query = f"conversation_id=eq.{cid}&select=id"
        url = f"{SUPABASE_URL}/rest/v1/messages?{msg_query}"
        req = urllib.request.Request(url)
        req.add_header('apikey', SUPABASE_KEY)
        req.add_header('Authorization', f"Bearer {SUPABASE_KEY}")
        req.add_header('Range', '0-0') # Just one to check existence, but we want count.
        # Actually let's just assume if we get IDs back it's alive.
        # To get count, we can use Head request or look at range.
        # Let's just fetch all IDs (limit 50) to see if > 0
        
        msgs = query_supabase('messages', f"conversation_id=eq.{cid}&select=id&limit=10")
        msg_count = len(msgs) if msgs else 0
        has_more = " (10+)" if msg_count == 10 else ""

        print(f"\n--------------------------------------------------")
        print(f"🆔 ID: {cid}")
        print(f"🔑 Thread Key: {conv.get('thread_key')}")
        print(f"📱 Chat ID: {conv.get('chat_id')}")
        print(f"👥 Is Group: {conv.get('is_group')}")
        print(f"🏷️ Title: '{conv.get('title')}'")
        print(f"👤 Contact ID: {conv.get('contact_id')}")
        print(f"📅 Updated: {conv.get('updated_at')}")
        print(f"💬 Messages (Sample): {msg_count}{has_more}")
        print(f"--------------------------------------------------")

if __name__ == "__main__":
    diagnose()
