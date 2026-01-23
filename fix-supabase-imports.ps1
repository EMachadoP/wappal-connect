# Fix Supabase imports in Edge Functions
# Replace esm.sh imports with npm: imports for Deno 2 compatibility

$files = @(
    "supabase\functions\_shared\logger.ts",
    "supabase\functions\zapi-webhook\index.ts",
    "supabase\functions\zapi-sync-history\index.ts",
    "supabase\functions\zapi-sync-contacts\index.ts",
    "supabase\functions\zapi-send-message\index.ts",
    "supabase\functions\zapi-send-file\index.ts",
    "supabase\functions\zapi-fix-group-duplicates\index.ts",
    "supabase\functions\zapi-backfill\index.ts",
    "supabase\functions\transcribe-audio\index.ts",
    "supabase\functions\store-media\index.ts",
    "supabase\functions\sla-metrics\index.ts",
    "supabase\functions\rebuild-plan\index.ts",
    "supabase\functions\protocol-opened\index.ts",
    "supabase\functions\protocol-client\index.ts",
    "supabase\functions\notify-open-tickets-group\index.ts",
    "supabase\functions\mark-conversation-read\index.ts",
    "supabase\functions\kb-generate-embedding\index.ts",
    "supabase\functions\kb-daily-ingest\index.ts",
    "supabase\functions\group-resolution-handler\index.ts",
    "supabase\functions\fix-protocol\index.ts",
    "supabase\functions\create-ticket\index.ts",
    "supabase\functions\create-task\index.ts",
    "supabase\functions\create-protocol\index.ts",
    "supabase\functions\create-agent\index.ts",
    "supabase\functions\assign-conversation\index.ts",
    "supabase\functions\ai-test\index.ts",
    "supabase\functions\ai-maybe-reply\index.ts",
    "supabase\functions\ai-auto-reactivate\index.ts",
    "supabase\functions\ai-generate-reply\index.ts"
)

$count = 0
foreach ($file in $files) {
    $fullPath = Join-Path $PSScriptRoot $file
    if (Test-Path $fullPath) {
        $content = Get-Content $fullPath -Raw
        
        # Replace all variations of esm.sh supabase-js imports
        $newContent = $content -replace 'from [''"]https://esm\.sh/@supabase/supabase-js@[0-9.]+[''"]', 'from "npm:@supabase/supabase-js@2.92.0"'
        
        if ($content -ne $newContent) {
            Set-Content -Path $fullPath -Value $newContent -NoNewline
            Write-Host "✓ Fixed: $file" -ForegroundColor Green
            $count++
        } else {
            Write-Host "○ Skipped (no match): $file" -ForegroundColor Yellow
        }
    } else {
        Write-Host "✗ Not found: $file" -ForegroundColor Red
    }
}

Write-Host "`n✓ Fixed $count file(s)" -ForegroundColor Cyan
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Test locally if needed" -ForegroundColor White
Write-Host "2. Deploy functions: supabase functions deploy <function-name>" -ForegroundColor White
Write-Host "3. Or deploy all: Get-ChildItem supabase\functions -Directory | ForEach-Object { supabase functions deploy `$_.Name }" -ForegroundColor White
