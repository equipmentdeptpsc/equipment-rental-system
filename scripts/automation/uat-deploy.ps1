param([ValidateSet('Migration','Application')][string]$Kind,[string]$ExpectedMigration='')
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $script:RepositoryRoot
Assert-UatTarget
$supabaseCli = Resolve-SupabaseCli
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
