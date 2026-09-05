# StudyGPS - full cleanup
# One combined script - supersedes the earlier delete_orphans.ps1 and
# delete_orphans_2.ps1, no need to run those separately anymore.
#
# Deletes files confirmed NOT referenced anywhere by the real, running app
# (checked by grepping every real .html/.js file for each name below).
# The two real database backup files are included but called out
# separately - skip that block if you want to keep them as a safety net.

$root = "C:\StudyGPS"

Write-Host "=== Unused frontend pages/styles ===" -ForegroundColor Cyan
$frontendFiles = @(
    "frontend\app-store.js",          # old mock-data layer, replaced by real API calls
    "frontend\course-library.html",
    "frontend\course-library.css",
    "frontend\quiz.html",
    "frontend\quiz.css",
    "frontend\route.html",
    "frontend\route.css",
    "frontend\reports.html",
    "frontend\timer.html",            # tasks.html has its own real timer, this was a dead duplicate
    "frontend\timer.css",
    "frontend\onboarding.html",       # nothing links to this anymore
    "frontend\progress_backup.html",
    "frontend\dashboard.css",         # every real page only loads common.css
    "frontend\progress.css",
    "frontend\schedule.css",
    "frontend\tasks.css",
    "frontend\style.css"
)
foreach ($f in $frontendFiles) {
    $p = Join-Path $root $f
    if (Test-Path $p) { Remove-Item $p -Force; Write-Host "Deleted: $p" }
    else { Write-Host "Not found (already gone): $p" }
}

Write-Host ""
Write-Host "=== Unused C++ engine files ===" -ForegroundColor Cyan
$cppFiles = @(
    "cpp_engine\hello.cpp",              # empty test file
    "cpp_engine\main.cpp",               # empty test file
    "cpp_engine\studyTracker_backup.cpp" # old backup, studyTracker.cpp is the real one
)
foreach ($f in $cppFiles) {
    $p = Join-Path $root $f
    if (Test-Path $p) { Remove-Item $p -Force; Write-Host "Deleted: $p" }
    else { Write-Host "Not found (already gone): $p" }
}

Write-Host ""
Write-Host "=== One-off migration script (already run) ===" -ForegroundColor Cyan
$p = Join-Path $root "database\migrate_material_pages.js"
if (Test-Path $p) { Remove-Item $p -Force; Write-Host "Deleted: $p" }
else { Write-Host "Not found (already gone): $p" }

Write-Host ""
Write-Host "=== Old database backup files (OPTIONAL - not your live data) ===" -ForegroundColor Yellow
Write-Host "These are NOT your real database (that's database\studygps.db, untouched)."
Write-Host "They're old snapshots. Comment out this block if you'd rather keep them."
$dbBackups = @(
    "database\studygps-claude-backup.db",
    "database\studygps-local-backup.db"
)
foreach ($f in $dbBackups) {
    $p = Join-Path $root $f
    if (Test-Path $p) { Remove-Item $p -Force; Write-Host "Deleted: $p" }
    else { Write-Host "Not found (already gone): $p" }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
