# Diagnóstico via API REST do Supabase
$ErrorActionPreference = "Continue"

# Carregar variáveis de ambiente do .env
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
        }
    }
}

$supabaseUrl = $env:SUPABASE_URL
$supabaseKey = $env:SUPABASE_SERVICE_ROLE_KEY

if (!$supabaseUrl -or !$supabaseKey) {
    Write-Host "❌ ERRO: Variáveis de ambiente não encontradas!" -ForegroundColor Red
    exit 1
}

$headers = @{
    "apikey"        = $supabaseKey
    "Authorization" = "Bearer $supabaseKey"
    "Content-Type"  = "application/json"
}

Write-Host "`n🔍 Diagnóstico de Mensagens - Teste06`n" -ForegroundColor Cyan

# 1. Procurar mensagem "Teste06"
Write-Host "1️⃣ Procurando mensagem 'Teste06'..." -ForegroundColor Yellow
try {
    $uri = $supabaseUrl + "/rest/v1/messages?content=ilike.*Teste06*&select=id,sender_name,content,sent_at,created_at&order=created_at.desc&limit=5"
    $response = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
    Write-Host "✅ Encontrado: $($response.Count) mensagens" -ForegroundColor Green
    if ($response.Count -gt 0) {
        $response | Format-Table -AutoSize
    }
}
catch {
    Write-Host "❌ Erro: $($_.Exception.Message)" -ForegroundColor Red
}

# 2. Verificar message_outbox
Write-Host "`n2️⃣ Verificando message_outbox..." -ForegroundColor Yellow
try {
    $uri = $supabaseUrl + "/rest/v1/message_outbox?preview=ilike.*Teste06*&select=id,status,error,preview,sent_at,created_at&order=created_at.desc&limit=5"
    $response = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
    Write-Host "✅ Encontrado: $($response.Count) registros" -ForegroundColor Green
    if ($response.Count -gt 0) {
        $response | Format-Table -AutoSize
    }
}
catch {
    Write-Host "❌ Erro: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. Verificar últimas mensagens da conversa
Write-Host "`n3️⃣ Buscando conversa do Eldon..." -ForegroundColor Yellow
try {
    $uri = $supabaseUrl + "/rest/v1/conversations?or=(chat_id.ilike.*558197438430*,thread_key.ilike.*558197438430*)&select=id,chat_id,thread_key"
    $convResponse = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
    
    if ($convResponse -and $convResponse.Count -gt 0) {
        $convId = $convResponse[0].id
        Write-Host "📝 Conversation ID: $convId" -ForegroundColor Green
        Write-Host "   chat_id: $($convResponse[0].chat_id)" -ForegroundColor Gray
        Write-Host "   thread_key: $($convResponse[0].thread_key)" -ForegroundColor Gray
        
        Write-Host "`n   Últimas 10 mensagens:" -ForegroundColor Yellow
        $uri = $supabaseUrl + "/rest/v1/messages?conversation_id=eq.$convId&select=id,sender_name,sender_type,content,sent_at,created_at&order=created_at.desc&limit=10"
        $messagesResponse = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
        Write-Host "   ✅ Encontrado: $($messagesResponse.Count) mensagens" -ForegroundColor Green
        if ($messagesResponse.Count -gt 0) {
            $messagesResponse | Format-Table sender_name, sender_type, @{Label = "Content"; Expression = { $_.content.Substring(0, [Math]::Min(50, $_.content.Length)) } }, sent_at -AutoSize
        }
    }
    else {
        Write-Host "⚠️ Conversa não encontrada" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "❌ Erro: $($_.Exception.Message)" -ForegroundColor Red
}

# 4. Verificar erros recentes
Write-Host "`n4️⃣ Erros recentes (última hora):" -ForegroundColor Yellow
try {
    $oneHourAgo = (Get-Date).AddHours(-1).ToString("yyyy-MM-ddTHH:mm:ss")
    $uri = $supabaseUrl + "/rest/v1/ai_logs?status=eq.error&created_at=gte.$oneHourAgo&select=status,error_message,model,created_at&order=created_at.desc&limit=10"
    $logsResponse = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
    Write-Host "✅ Encontrado: $($logsResponse.Count) erros" -ForegroundColor Green
    if ($logsResponse.Count -gt 0) {
        $logsResponse | Format-Table model, @{Label = "Error"; Expression = { $_.error_message.Substring(0, [Math]::Min(80, $_.error_message.Length)) } }, created_at -AutoSize
    }
}
catch {
    Write-Host "❌ Erro: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n✅ Diagnóstico completo!`n" -ForegroundColor Cyan
