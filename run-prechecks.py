import os
import requests
import json

def get_env():
    env = {}
    if os.path.exists(".env"):
        with open(".env", "r") as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    env[k.strip()] = v.strip().strip("'").strip('"')
    return env

def main():
    env = get_env()
    url = env.get("SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        return

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}"
    }

    print("🔍 [PRE-CHECK]")

    # 1. Count u:%
    try:
        res = requests.get(f"{url}/rest/v1/conversations?thread_key=like.u%3A*", headers=headers)
        if res.status_code == 200:
            print(f"U_COUNT: {len(res.json())}")
        else:
            print(f"Error U_COUNT: {res.status_code} {res.text}")
    except Exception as e:
        print(f"Exception U_COUNT: {e}")

    # 2. Eldon's Check
    try:
        res = requests.get(f"{url}/rest/v1/conversations?chat_id=ilike.*558197438430*&select=id,thread_key", headers=headers)
        if res.status_code == 200:
            print("\n🔍 Eldon's Conversations:")
            print(json.dumps(res.json(), indent=2))
        else:
            print(f"Error Eldon: {res.status_code}")
    except Exception as e:
        print(f"Exception Eldon: {e}")

if __name__ == "__main__":
    main()
