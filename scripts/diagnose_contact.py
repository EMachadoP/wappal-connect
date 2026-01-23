
import os
import json
import urllib.request

SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co'
SUPABASE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD' # Temporary for diagnostic
CONTACT_ID = 'bddcb3ae-33e2-46f8-8fe5-ea6d4e403f94'

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

def diagnose_contact():
    print(f"🔍 Diagnosing contact: {CONTACT_ID}")
    
    contacts = query_supabase('contacts', f"id=eq.{CONTACT_ID}")
    
    if not contacts:
        print("❌ Contact not found.")
        return

    c = contacts[0]
    print(f"\n👤 Contact Details:")
    print(f"ID: {c.get('id')}")
    print(f"Name: '{c.get('name')}'")
    print(f"Phone: {c.get('phone')}")
    print(f"LID: {c.get('lid')}")
    print(f"Chat LID: {c.get('chat_lid')}")
    print(f"Is Group: {c.get('is_group')}")
    print(f"Group Name: {c.get('group_name')}")
    print(f"Whatsapp Display Name: {c.get('whatsapp_display_name')}")

if __name__ == "__main__":
    diagnose_contact()
