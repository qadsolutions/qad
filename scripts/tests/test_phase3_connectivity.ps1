$IntakeWebhook = "http://localhost:5678/webhook/customer-intake"
$DocWebhook    = "http://localhost:5678/webhook/document-intake"
$ApptWebhook   = "http://localhost:5678/webhook/appointment"

$Pass = 0
$Fail = 0

function Invoke-Check {
    param([string]$Label, [scriptblock]$Test)
    try {
        $result = & $Test
        if ($result) {
            Write-Host "  PASS  $Label" -ForegroundColor Green
            $script:Pass++
        } else {
            Write-Host "  FAIL  $Label" -ForegroundColor Red
            $script:Fail++
        }
    } catch {
        Write-Host "  FAIL  $Label - $($_.Exception.Message)" -ForegroundColor Red
        $script:Fail++
    }
}

function Invoke-DB {
    param([string]$Sql)
    $out = docker exec qad_postgres psql -U qad_user -d qad -t -A -c $Sql 2>&1
    return $out.Trim()
}

function Post-Webhook {
    param([string]$Uri, [hashtable]$Body)
    try {
        return Invoke-RestMethod -Uri $Uri -Method POST -Body ($Body | ConvertTo-Json -Depth 5) -ContentType "application/json"
    } catch {
        try { return $_.ErrorDetails.Message | ConvertFrom-Json } catch { return $null }
    }
}

Write-Host ""
Write-Host "Phase 3 - Connectivity and Storage Testing" -ForegroundColor Cyan
Write-Host "Clearing test data..." -ForegroundColor DarkGray
docker exec qad_postgres psql -U qad_user -d qad -c "TRUNCATE intake_log, document_log, appointment_log, workflow_runs, audit_log RESTART IDENTITY;" 2>&1 | Out-Null
Start-Sleep -Seconds 1

# ======================================================
# SECTION 1: Customer Intake
# ======================================================
Write-Host ""
Write-Host "[1] Customer Intake" -ForegroundColor Yellow

$intakeResp = Post-Webhook -Uri $IntakeWebhook -Body @{
    source_type      = "form"
    contact_name     = "Phase3 Test"
    contact_email    = "phase3@example.com"
    company_name     = "Test Corp"
    service_category = "consulting"
    monthly_budget   = 5000
    message_body     = "We need help with our operations workflow automation"
    client_id        = "acme_corp"
}

Invoke-Check "Intake webhook returns response" { $intakeResp -ne $null }
Invoke-Check "Intake response has intake_id" { $intakeResp.intake_id -ne $null -and $intakeResp.intake_id -ne "" }

Start-Sleep -Seconds 4

Invoke-Check "intake_log row persisted" {
    (Invoke-DB "SELECT COUNT(*) FROM intake_log WHERE contact_email='phase3@example.com'") -eq "1"
}
Invoke-Check "intake_log qualification_tier is set" {
    (Invoke-DB "SELECT qualification_tier FROM intake_log WHERE contact_email='phase3@example.com'") -ne ""
}
Invoke-Check "intake_log client_id is acme_corp" {
    (Invoke-DB "SELECT client_id FROM intake_log WHERE contact_email='phase3@example.com'") -eq "acme_corp"
}

# ======================================================
# SECTION 2: Document Intake
# ======================================================
Write-Host ""
Write-Host "[2] Document Intake" -ForegroundColor Yellow

$docResp = Post-Webhook -Uri $DocWebhook -Body @{
    client_id     = "acme_corp"
    source_type   = "upload"
    file_name     = "invoice_phase3.pdf"
    file_type     = "pdf"
    document_text = "INVOICE Invoice Number: INV-2026-P3 Vendor: Acme Supplies Bill To: Test Corp Amount Due: 4500.00 Due Date: 2026-06-01 Payment Terms: Net 30"
}

Invoke-Check "Document webhook returns response" { $docResp -ne $null }
Invoke-Check "Document response has document_id" { $docResp.document_id -ne $null -and $docResp.document_id -ne "" }
Invoke-Check "Document classified as invoice" { $docResp.classification_label -eq "invoice" }

Start-Sleep -Seconds 4

Invoke-Check "document_log row persisted" {
    (Invoke-DB "SELECT COUNT(*) FROM document_log WHERE file_name='invoice_phase3.pdf'") -eq "1"
}
Invoke-Check "document_log confidence_score > 0" {
    [double](Invoke-DB "SELECT confidence_score FROM document_log WHERE file_name='invoice_phase3.pdf'") -gt 0
}

# ======================================================
# SECTION 3: Appointment Scheduling
# ======================================================
Write-Host ""
Write-Host "[3] Appointment Scheduling" -ForegroundColor Yellow

$apptResp = Post-Webhook -Uri $ApptWebhook -Body @{
    client_id      = "acme_corp"
    source_type    = "internal"
    request_type   = "book"
    contact_name   = "Phase3 Patient"
    contact_email  = "phase3appt@example.com"
    service_type   = "consultation"
    requested_time = "2026-06-15T10:00:00Z"
    timezone       = "America/Chicago"
}

Invoke-Check "Appointment webhook returns response" { $apptResp -ne $null }
Invoke-Check "Appointment response has appointment_id" { $apptResp.appointment_id -ne $null -and $apptResp.appointment_id -ne "" }
Invoke-Check "Internal source auto-confirmed" { $apptResp.status -eq "confirmed" }

Start-Sleep -Seconds 4

Invoke-Check "appointment_log row persisted as confirmed" {
    (Invoke-DB "SELECT COUNT(*) FROM appointment_log WHERE contact_email='phase3appt@example.com' AND status='confirmed'") -eq "1"
}
Invoke-Check "appointment_log reminder_sequence not empty" {
    (Invoke-DB "SELECT reminder_sequence FROM appointment_log WHERE contact_email='phase3appt@example.com'") -ne "[]"
}

# ======================================================
# SECTION 4: workflow_runs table
# ======================================================
Write-Host ""
Write-Host "[4] workflow_runs logging" -ForegroundColor Yellow

Start-Sleep -Seconds 3

Invoke-Check "workflow_runs has intake row" {
    [int](Invoke-DB "SELECT COUNT(*) FROM workflow_runs WHERE workflow_id='customer_intake_v1'") -ge 1
}
Invoke-Check "workflow_runs has document row" {
    [int](Invoke-DB "SELECT COUNT(*) FROM workflow_runs WHERE workflow_id='document_intake_v1'") -ge 1
}
Invoke-Check "workflow_runs has appointment row" {
    [int](Invoke-DB "SELECT COUNT(*) FROM workflow_runs WHERE workflow_id='appointment_scheduling_v1'") -ge 1
}
Invoke-Check "workflow_runs run_status populated on all rows" {
    $total = [int](Invoke-DB "SELECT COUNT(*) FROM workflow_runs")
    $withStatus = [int](Invoke-DB "SELECT COUNT(*) FROM workflow_runs WHERE run_status IS NOT NULL")
    $total -gt 0 -and $total -eq $withStatus
}
Invoke-Check "workflow_runs business_outcome populated" {
    [int](Invoke-DB "SELECT COUNT(*) FROM workflow_runs WHERE business_outcome IS NOT NULL") -ge 1
}

# ======================================================
# SECTION 5: View correctness
# ======================================================
Write-Host ""
Write-Host "[5] View correctness" -ForegroundColor Yellow

Invoke-Check "v_recent_activity returns rows" {
    [int](Invoke-DB "SELECT COUNT(*) FROM v_recent_activity") -gt 0
}
Invoke-Check "v_recent_activity covers all 3 automations" {
    [int](Invoke-DB "SELECT COUNT(DISTINCT automation) FROM v_recent_activity") -eq 3
}
Invoke-Check "v_workflow_health has rows for all 3 automations" {
    [int](Invoke-DB "SELECT COUNT(*) FROM v_workflow_health") -eq 3
}
Invoke-Check "v_client_summary shows acme_corp" {
    (Invoke-DB "SELECT client_id FROM v_client_summary WHERE client_id='acme_corp'") -eq "acme_corp"
}
Invoke-Check "v_client_summary acme_corp has activity in all 3 automations" {
    $intakes = [int](Invoke-DB "SELECT total_intakes FROM v_client_summary WHERE client_id='acme_corp'")
    $docs    = [int](Invoke-DB "SELECT total_documents FROM v_client_summary WHERE client_id='acme_corp'")
    $appts   = [int](Invoke-DB "SELECT total_appointments FROM v_client_summary WHERE client_id='acme_corp'")
    $intakes -ge 1 -and $docs -ge 1 -and $appts -ge 1
}
Invoke-Check "v_daily_summary returns rows" {
    [int](Invoke-DB "SELECT COUNT(*) FROM v_daily_summary") -gt 0
}

# ======================================================
# SECTION 6: Storage integrity
# ======================================================
Write-Host ""
Write-Host "[6] Storage integrity" -ForegroundColor Yellow

$prevCount = [int](Invoke-DB "SELECT COUNT(*) FROM intake_log")
$intakeResp2 = Post-Webhook -Uri $IntakeWebhook -Body @{
    source_type      = "form"
    contact_name     = "Phase3 Test"
    contact_email    = "phase3@example.com"
    company_name     = "Test Corp"
    service_category = "consulting"
    monthly_budget   = 5000
    message_body     = "We need help with our operations workflow automation"
    client_id        = "acme_corp"
}
Invoke-Check "Duplicate intake does not crash" { $intakeResp2 -ne $null }

Start-Sleep -Seconds 3
Invoke-Check "Duplicate intake creates second row (both logged)" {
    [int](Invoke-DB "SELECT COUNT(*) FROM intake_log WHERE contact_email='phase3@example.com'") -eq 2
}
Invoke-Check "Second intake row has is_duplicate=true" {
    (Invoke-DB "SELECT is_duplicate FROM intake_log WHERE contact_email='phase3@example.com' ORDER BY received_at DESC LIMIT 1") -eq "t"
}

$badResp = Post-Webhook -Uri $ApptWebhook -Body @{
    request_type  = "book"
    contact_email = "bad@example.com"
}
Invoke-Check "Appointment validation failure handled (no crash)" {
    $badResp -ne $null -and ($badResp.status -eq "error" -or $badResp.errors -ne $null)
}

$emptyResp = Post-Webhook -Uri $DocWebhook -Body @{}
Invoke-Check "Document empty body handled (no crash)" { $emptyResp -ne $null }

# ======================================================
# RESULTS
# ======================================================
Write-Host ""
Write-Host "Phase 3 results: $Pass passed, $Fail failed." -ForegroundColor Cyan
if ($Fail -eq 0) {
    Write-Host "All connectivity and storage checks passed." -ForegroundColor Green
} else {
    Write-Host "$Fail check(s) failed - review above." -ForegroundColor Red
}
