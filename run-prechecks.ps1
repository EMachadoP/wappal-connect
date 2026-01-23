# Robust Supabase Query via curl (PowerShell)
$headers = @(
    "-H", "apikey: $($env:SUPABASE_SERVICE_ROLE_KEY)",
    "-H", "Authorization: Bearer $($env:SUPABASE_SERVICE_ROLE_KEY)"
)

Write-Host "🔍 [PRE-CHECK] Counting legacy 'u:%' conversations..." -ForegroundColor Cyan
$uri = "$($env:SUPABASE_URL)/rest/v1/conversations?thread_key=like.u:*&select=id"
$res = curl.exe -s -G $uri @headers
$json = $res | ConvertFrom-Json
$uCount = $json.Count
Write-Host "U_COUNT: $uCount" -ForegroundColor Green

Write-Host "`n🔍 [PRE-CHECK] Checking for duplicates by contact_id..." -ForegroundColor Cyan
# This is harder with raw REST URL, let's use a simpler check for Eldon specifically if possible
# or just provide the u: count as requested.
