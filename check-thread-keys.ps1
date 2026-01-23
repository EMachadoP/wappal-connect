# Check thread_keys for Eldon
$headers = @{
    "apikey"        = $env:SUPABASE_SERVICE_ROLE_KEY
    "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
}

Write-Host "🔍 Listing all conversations for Eldon (558197438430)..." -ForegroundColor Cyan
$uri = "$($env:SUPABASE_URL)/rest/v1/conversations?select=id,thread_key,contact_id,chat_id&or=(chat_id.ilike.*558197438430*,thread_key.ilike.*558197438430*)"
$response = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
$response | Format-Table -AutoSize
