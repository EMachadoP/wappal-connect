# Get count of legacy thread keys
$headers = @{
    "apikey"        = $env:SUPABASE_SERVICE_ROLE_KEY
    "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
}

$uri = $env:SUPABASE_URL + "/rest/v1/conversations?thread_key=like.u:*&select=id"
$response = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
$count = $response.Count

Write-Host "--- DATA ---"
Write-Host "U_COUNT=$count"
Write-Host "--- END ---"
