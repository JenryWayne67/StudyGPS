cd C:\StudyGPS
Remove-Item -Force -ErrorAction SilentlyContinue `
  "cpp_engine\hello.cpp", `
  "cpp_engine\main.cpp", `
  "cpp_engine\studyTracker_backup.cpp", `
  "database\migrate_material_pages.js", `
  "database\studygps-claude-backup.db", `
  "database\studygps-local-backup.db", `
  "frontend\course-library.css", `
  "frontend\dashboard.css", `
  "frontend\progress.css", `
  "frontend\schedule.css", `
  "frontend\tasks.css", `
  "frontend\timer.css", `
  "frontend\style.css", `
  "frontend\progress_backup.html"
Write-Host "Done."
