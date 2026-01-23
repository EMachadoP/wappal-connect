$headers = @{
    "apikey"        = $env:SUPABASE_SERVICE_ROLE_KEY
    "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
}
$url = "$($env:SUPABASE_URL)/rest/v1/conversations?thread_key=like.u:*"
$res = Invoke-RestMethod -Uri $url -Headers $headers -Method Get
Write-Host "U_COUNT: $($res.Count)"
