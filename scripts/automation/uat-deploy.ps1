param([ValidateSet('Migration','Application')][string]$Kind,[string]$ExpectedMigration='')
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $script:RepositoryRoot
Assert-UatTarget
$supabaseCli = Resolve-SupabaseCli
if ($Kind -eq 'Application') {
  # Build-time values are process-scoped; the key is never printed or persisted.
  if (-not $env:VITE_PERSISTENCE_MODE) { $env:VITE_PERSISTENCE_MODE = 'remote' }
  if (-not $env:VITE_SUPABASE_URL) { $env:VITE_SUPABASE_URL = "https://$($script:ExpectedUatProjectRef).supabase.co" }
  if (-not $env:VITE_SUPABASE_PUBLISHABLE_KEY -and $env:SUPABASE_PUBLISHABLE_KEY) { $env:VITE_SUPABASE_PUBLISHABLE_KEY = $env:SUPABASE_PUBLISHABLE_KEY }
  if (-not $env:VITE_REMOTE_OPERATIONAL_WRITES_ENABLED) { $env:VITE_REMOTE_OPERATIONAL_WRITES_ENABLED = 'false' }
}
if ($Kind -eq 'Migration') {
  if (-not $ExpectedMigration) { throw 'ExpectedMigration is required for migration deployment.' }
  & (Join-Path $PSScriptRoot 'uat-preflight.ps1') -ExpectedPendingMigration $ExpectedMigration
} else {
  & (Join-Path $PSScriptRoot 'uat-preflight.ps1')
}
if ($LASTEXITCODE -ne 0) { throw 'UAT preflight failed.' }
if ($Kind -eq 'Migration') {
  # Keep stdin/stdout/stderr attached to the host console so Supabase's
  # confirmation prompt is visible and answerable. Invoke-LoggedStep redirects
  # all streams to a file, which makes an interactive db push wait indefinitely.
  & $supabaseCli db push --linked
  if ($LASTEXITCODE -ne 0) { throw "uat-migration-push exited with $LASTEXITCODE" }
  Write-Host 'PASS uat-migration-push'
} else {
  & node (Join-Path $script:RepositoryRoot 'scripts\validate-uat-build.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'UAT application build configuration validation failed.' }
  & node (Join-Path $script:RepositoryRoot 'node_modules\typescript\bin\tsc') -b
  if ($LASTEXITCODE -ne 0) { throw 'UAT application TypeScript build failed.' }
  & node (Join-Path $script:RepositoryRoot 'node_modules\vite\bin\vite.js') build
  if ($LASTEXITCODE -ne 0) { throw 'UAT application Vite build failed.' }
  Invoke-LoggedStep 'uat-application-deploy' { & (Join-Path $script:BinRoot 'wrangler.cmd') deploy --env uat }
}
git rev-parse HEAD | Set-Content (Join-Path $script:ReportRoot 'last-deployed-commit.txt')
Write-Host "RESULT PASS isolated-UAT $Kind deployment"
