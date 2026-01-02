# Script de Release Completo
# Automatiza todo o processo de atualização e deployment

param(
    [Parameter(Mandatory = $true)]
    [string]$CommitMessage
)

Write-Host "🚀 Iniciando processo de release completo..." -ForegroundColor Cyan
Write-Host ""

# ============================================
# 1. Git Add
# ============================================
Write-Host "📦 Adicionando arquivos ao Git..." -ForegroundColor Yellow
git add .

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erro ao adicionar arquivos" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Arquivos adicionados" -ForegroundColor Green
Write-Host ""

# ============================================
# 2. Git Commit
# ============================================
Write-Host "💾 Fazendo commit..." -ForegroundColor Yellow
git commit -m "$CommitMessage"

if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Nenhuma mudança para commit ou erro" -ForegroundColor Yellow
    Write-Host ""
}
else {
    Write-Host "✅ Commit realizado" -ForegroundColor Green
    Write-Host ""
}

# ============================================
# 3. Git Push
# ============================================
Write-Host "⬆️  Enviando para GitHub..." -ForegroundColor Yellow
git push origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erro ao fazer push" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Push realizado com sucesso" -ForegroundColor Green
Write-Host ""

# ============================================
# 4. Deploy Edge Functions
# ============================================
Write-Host "🔧 Iniciando deploy das Edge Functions..." -ForegroundColor Yellow
Write-Host ""

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
    Write-Host "  📦 Deploying $func..." -ForegroundColor Cyan
    
    npx supabase functions deploy $func 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ $func deployed" -ForegroundColor Green
        $success++
    }
    else {
        Write-Host "  ❌ $func failed" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "📊 Edge Functions - Sucesso: $success | Falhas: $failed" -ForegroundColor Cyan
Write-Host ""

# ============================================
# 5. Aguardar Vercel
# ============================================
Write-Host "⏳ Aguardando deployment no Vercel..." -ForegroundColor Yellow
Write-Host "   (O Vercel faz deploy automático quando você faz push)" -ForegroundColor Gray
Write-Host ""
Start-Sleep -Seconds 5

# ============================================
# 6. Resumo Final
# ============================================
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "✅ RELEASE COMPLETO!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Resumo:" -ForegroundColor White
Write-Host "  ✅ Commit: $CommitMessage" -ForegroundColor Green
Write-Host "  ✅ Push para GitHub: Concluído" -ForegroundColor Green
Write-Host "  ✅ Edge Functions: $success/$($functions.Count) deployadas" -ForegroundColor Green
Write-Host "  ⏳ Vercel: Deploy automático em andamento" -ForegroundColor Yellow
Write-Host ""
Write-Host "🔗 Links úteis:" -ForegroundColor White
Write-Host "  📊 Vercel Deployments: https://vercel.com/eldons-projects-3194802d/wappal-connect/deployments" -ForegroundColor Cyan
Write-Host "  🌐 Produção: https://wappal-connect.vercel.app" -ForegroundColor Cyan
Write-Host "  🔧 Supabase Functions: https://supabase.com/dashboard/project/qoolzhzdcfnyblymdvbq/functions" -ForegroundColor Cyan
Write-Host ""
Write-Host "💡 Próximos passos:" -ForegroundColor White
Write-Host "  1. Aguarde ~1-2 minutos para o Vercel completar o deploy" -ForegroundColor Gray
Write-Host "  2. Acesse o link de Produção para testar" -ForegroundColor Gray
Write-Host "  3. Verifique os logs se houver algum problema" -ForegroundColor Gray
Write-Host ""
