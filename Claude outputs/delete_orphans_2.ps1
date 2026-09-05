# StudyGPS - cleanup batch 2
# Deletes files confirmed unused/orphaned this round (nothing in the real
# app links to them anymore - verified by grep across frontend/*.html).
# Run this from PowerShell, from anywhere (uses the fixed path below).
# Review the list first if you want - it only touches these 8 files.

$root = "C:\StudyGPS\frontend"

$files = @(
    "quiz.html",
    "quiz.css",
    "route.html",
    "route.css",
    "reports.html",
    "course-library.html",
    "timer.html",
    "onboarding.html"
)

foreach ($f in $files) {
    $p = Join-Path $root $f
    if (Test-Path $p) {
        Remove-Item $p -Force
        Write-Host "Deleted: $p"
    } else {
        Write-Host "Not found (already gone): $p"
    }
}

Write-Host ""
Write-Host "Done. If you also haven't run the first cleanup batch (delete_orphans.ps1)"
Write-Host "from earlier, that one is still separate and still valid to run too."
