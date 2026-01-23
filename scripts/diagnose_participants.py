
import os
import json
import urllib.request

SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co'
SUPABASE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD' # Temporary
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

def diagnose_participants():
    print(f"🔍 Diagnosing participants for ID fragment: {TARGET_ID}")
    
    # 1. Get Conversation ID first
    query = f"or=(thread_key.ilike.*{TARGET_ID}*,chat_id.ilike.*{TARGET_ID}*)&select=id,is_group&limit=1"
    convs = query_supabase('conversations', query)
    
    if not convs:
        print("❌ Conversation not found.")
        return

    cid = convs[0]['id']
    is_group = convs[0]['is_group']
    print(f"🆔 Conversation ID: {cid} (Is Group: {is_group})")

    # 2. Check participants
    p_query = f"conversation_id=eq.{cid}&select=id,name,role_type"
    parts = query_supabase('participants', p_query)
    
    print(f"\n👥 Participants Found: {len(parts) if parts else 0}")
    if parts:
        for p in parts:
            print(f" - ID: {p.get('id')}, Name: '{p.get('name')}', Role: {p.get('role_type')}")

if __name__ == "__main__":
    diagnose_participants()
