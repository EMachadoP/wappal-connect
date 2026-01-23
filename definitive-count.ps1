# Definitive check
$ErrorActionPreference = "Stop"

$v_url = ""
$v_key = ""

if (Test-Path ".env") {
    $lines = Get-Content ".env"
    foreach ($line in $lines) {
        if ($line -match "^SUPABASE_URL=(.*)$") { $v_url = $matches[1].Trim().Trim("'").Trim('"') }
        if ($line -match "^SUPABASE_SERVICE_ROLE_KEY=(.*)$") { $v_key = $matches[1].Trim().Trim("'").Trim('"') }
    }
}

$headers = @{
    "apikey"        = $v_key
    "Authorization" = ("Bearer " + $v_key)
}

$uri = ($v_url + "/rest/v1/conversations?thread_key=like.u%3A*")

$res = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
if ($null -eq $res) {
    Write-Output "U_COUNT: 0"
}
else {
    Write-Output ("U_COUNT: " + $res.Count)
}
