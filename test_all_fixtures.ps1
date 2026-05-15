$url = "http://localhost:5678/webhook/customer-intake"
$headers = @{ "Content-Type" = "application/json" }

Write-Host "`n=== TEST 1: Hot Lead ===" -ForegroundColor Cyan
$body = '{"first_name":"Sarah","last_name":"Chen","email":"sarah.chen@techcorp.com","company_name":"TechCorp Solutions","industry":"SaaS","pain_points":"Our onboarding takes 3 weeks manually. We need it automated to under 48 hours.","monthly_budget":5000,"timeline":"immediate"}'
try { Invoke-RestMethod -Method POST -Uri $url -Headers $headers -Body $body | ConvertTo-Json } catch { Write-Host "ERROR: $_" -ForegroundColor Red }

Write-Host "`n=== TEST 2: Warm Lead ===" -ForegroundColor Cyan
$body = '{"first_name":"Marcus","last_name":"Rivera","email":"marcus@localretail.com","company_name":"Local Retail Co","industry":"Retail","pain_points":"Manual stock checks are error-prone and time-consuming.","monthly_budget":1200,"timeline":"1_3_months"}'
try { Invoke-RestMethod -Method POST -Uri $url -Headers $headers -Body $body | ConvertTo-Json } catch { Write-Host "ERROR: $_" -ForegroundColor Red }

Write-Host "`n=== TEST 3: Disqualified Lead ===" -ForegroundColor Cyan
$body = '{"first_name":"Jordan","last_name":"Smith","email":"jordan@personal.net","industry":"Other","pain_points":"Things take too long.","monthly_budget":100,"timeline":"6_plus_months"}'
try { Invoke-RestMethod -Method POST -Uri $url -Headers $headers -Body $body | ConvertTo-Json } catch { Write-Host "ERROR: $_" -ForegroundColor Red }

Write-Host "`n=== TEST 4: Validation Error (bad email) ===" -ForegroundColor Cyan
$body = '{"first_name":"Test","last_name":"User","email":"not-a-valid-email","industry":"Healthcare","pain_points":"Test pain points","monthly_budget":2000,"timeline":"immediate"}'
try { Invoke-RestMethod -Method POST -Uri $url -Headers $headers -Body $body | ConvertTo-Json } catch { Write-Host "ERROR (expected 400): $_" -ForegroundColor Yellow }

Write-Host "`n=== TEST 5: AI Failure Simulation ===" -ForegroundColor Cyan
$body = '{"first_name":"Override","last_name":"Test","email":"override@test.com","industry":"Finance","pain_points":"Manual compliance checks miss deadlines.","monthly_budget":8000,"timeline":"immediate","simulate_ai_failure":true}'
try { Invoke-RestMethod -Method POST -Uri $url -Headers $headers -Body $body | ConvertTo-Json } catch { Write-Host "ERROR: $_" -ForegroundColor Red }

Write-Host "`nAll tests complete." -ForegroundColor Green
