# Deploy de Todas as Edge Functions
# Execute este script quando fizer mudanças em qualquer Edge Function

Write-Host "🚀 Iniciando deploy de todas as Edge Functions..." -ForegroundColor Cyan
Write-Host ""

# Lista de todas as Edge Functions do projeto
$functions = @(
    "zapi-webhook",
    "protocol-opened",
    "ai-maybe-reply",
    "assign-conversation",
    "transcribe-audio",
    "zapi-send-message",
    "create-agent",
    "group-resolution-handler"
)

$success = 0
$failed = 0

foreach ($func in $functions) {
    Write-Host "📦 Deploying $func..." -ForegroundColor Yellow
    
    try {
        npx supabase functions deploy $func
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ $func deployed successfully!" -ForegroundColor Green
            $success++
        } else {
            Write-Host "❌ Failed to deploy $func" -ForegroundColor Red
            $failed++
        }
    } catch {
        Write-Host "❌ Error deploying $func : $_" -ForegroundColor Red
        $failed++
    }
    
    Write-Host ""
}

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "📊 Resumo do Deploy:" -ForegroundColor Cyan
Write-Host "✅ Sucesso: $success" -ForegroundColor Green
Write-Host "❌ Falhas: $failed" -ForegroundColor Red
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

if ($failed -eq 0) {
    Write-Host ""
    Write-Host "🎉 Todas as Edge Functions foram deployadas com sucesso!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "⚠️  Algumas funções falharam. Verifique os erros acima." -ForegroundColor Yellow
}
