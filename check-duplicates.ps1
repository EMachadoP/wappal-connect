# Check for duplicate conversations for Eldon's phone
$headers = @{
    "apikey"        = $env:SUPABASE_SERVICE_ROLE_KEY
    "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
}

Write-Host "🔍 Checking for conversations related to 558197438430..." -ForegroundColor Cyan

# Search by chat_id or contact aliases
$uri = "$($env:SUPABASE_URL)/rest/v1/conversations?select=id,chat_id,thread_key,contact_id,status,created_at&or=(chat_id.ilike.*558197438430*,thread_key.ilike.*558197438430*)"
$convs = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get

if ($convs.Count -gt 1) {
    Write-Host "⚠️ Found $($convs.Count) duplicate conversations!" -ForegroundColor Red
    $convs | Format-Table -AutoSize
}
else {
    Write-Host "✅ Only $($convs.Count) conversation found." -ForegroundColor Green
    $convs | Format-Table -AutoSize
}

# Check contacts for this phone
Write-Host "`n🔍 Checking contacts for 558197438430..." -ForegroundColor Cyan
$uri = "$($env:SUPABASE_URL)/rest/v1/contacts?select=id,phone,chat_key,chat_lid,name&or=(phone.eq.558197438430,chat_key.eq.558197438430)"
$contacts = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
$contacts | Format-Table -AutoSize
