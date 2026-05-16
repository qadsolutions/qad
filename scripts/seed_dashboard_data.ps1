#!/usr/bin/env pwsh
# Seed script -- populates acme_corp data across all 3 automations
# Run from anywhere: .\seed_dashboard_data.ps1

$base_intake  = "http://localhost:5678/webhook/customer-intake"
$base_doc     = "http://localhost:5678/webhook/document-intake"
$base_appt    = "http://localhost:5678/webhook/appointment"

$global:ok  = 0
$global:err = 0

function Get-Label($j) {
  if ($j.qualification_tier) { return $j.qualification_tier }
  if ($j.status)              { return $j.status }
  if ($j.appointment_id)      { return "appt: $($j.appointment_id.Substring(0,8))..." }
  return "--"
}

function Post($url, $body) {
  try {
    $r = Invoke-WebRequest $url -Method POST -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 10) -UseBasicParsing
    $j = $r.Content | ConvertFrom-Json
    Write-Host "  OK  $(Get-Label $j)" -ForegroundColor Green
    $global:ok++
  } catch {
    Write-Host "  ERR $($_.Exception.Message)" -ForegroundColor Red
    $global:err++
  }
  Start-Sleep -Milliseconds 400
}

# -------------------------------------------------
Write-Host ""
Write-Host "Customer Intake leads (12 records)" -ForegroundColor Cyan
# -------------------------------------------------

$intakeLeads = @(
  @{ first_name="Sarah"; last_name="Chen"; email="sarah.chen@techcorp.com"; company_name="TechCorp Solutions"; industry="SaaS"; business_description="We build B2B project management software with 200 active clients."; pain_points="Our onboarding takes 3 weeks manually. Need it automated to under 48 hours."; monthly_budget=5000; timeline="immediate"; referral_source="LinkedIn"; client_id="acme_corp" },
  @{ first_name="James"; last_name="Wilson"; email="jwilson@healthnet.org"; company_name="HealthNet Partners"; industry="Healthcare"; business_description="Regional health network managing patient intake for 6 clinics."; pain_points="Manual patient intake causes 40-minute wait times at peak hours."; monthly_budget=7500; timeline="immediate"; referral_source="Referral"; client_id="acme_corp" },
  @{ first_name="Priya"; last_name="Patel"; email="priya@financelogic.io"; company_name="FinanceLogic"; industry="Finance"; business_description="SMB accounting firm processing 200+ client documents monthly."; pain_points="Document processing backlog grows 15% monthly. Need auto-classification."; monthly_budget=3500; timeline="1_3_months"; referral_source="Google"; client_id="acme_corp" },
  @{ first_name="Marcus"; last_name="Rivera"; email="marcus@localretail.com"; company_name="Local Retail Co"; industry="Retail"; business_description="Small retail chain with 4 locations. Looking to automate inventory alerts."; pain_points="Manual stock checks are error-prone and time-consuming."; monthly_budget=1200; timeline="1_3_months"; referral_source="Google"; client_id="acme_corp" },
  @{ first_name="Elena"; last_name="Vasquez"; email="evasquez@lawgroup.com"; company_name="Vasquez Law Group"; industry="Legal"; business_description="Boutique litigation firm needing contract intake automation."; pain_points="New client intake paperwork takes days to process. Missing deadlines."; monthly_budget=4200; timeline="immediate"; referral_source="LinkedIn"; client_id="acme_corp" },
  @{ first_name="Tom"; last_name="Harris"; email="tom.harris@constructco.com"; company_name="ConstructCo"; industry="Construction"; business_description="Mid-size commercial construction firm managing 20 active projects."; pain_points="Project documentation is scattered. Cannot find permits or contracts quickly."; monthly_budget=2800; timeline="1_3_months"; referral_source="Trade Show"; client_id="acme_corp" },
  @{ first_name="Aisha"; last_name="Okonkwo"; email="a.okonkwo@edtech.co"; company_name="EduBridge"; industry="Education"; business_description="Online tutoring platform connecting 5,000 students with tutors."; pain_points="Session scheduling is manual. Students wait 2+ days for tutor assignment."; monthly_budget=1800; timeline="1_3_months"; referral_source="Webinar"; client_id="acme_corp" },
  @{ first_name="David"; last_name="Lee"; email="dlee@propertygroup.com"; company_name="Apex Property Group"; industry="Real Estate"; business_description="Property management company overseeing 300 rental units."; pain_points="Maintenance requests are tracked in spreadsheets. Things fall through."; monthly_budget=2000; timeline="3_6_months"; referral_source="Referral"; client_id="acme_corp" },
  @{ first_name="Jordan"; last_name="Smith"; email="jordan@personal.net"; company_name=""; industry="Other"; business_description="Just starting out, want to try some automation stuff."; pain_points="Things take too long."; monthly_budget=100; timeline="6_plus_months"; referral_source=""; client_id="acme_corp" },
  @{ first_name="Kevin"; last_name="Brooks"; email="k.brooks@tinyshop.net"; company_name="Kevins Corner Shop"; industry="Retail"; business_description="Single-location gift shop, 2 employees."; pain_points="I get too many emails."; monthly_budget=80; timeline="6_plus_months"; referral_source=""; client_id="acme_corp" },
  @{ first_name="Nadia"; last_name="Sokolova"; email="nadia@mfg.ru"; company_name="GlobalMFG"; industry="Manufacturing"; business_description="International manufacturing with US expansion. Need supply chain automation."; pain_points="Cross-border document compliance is a bottleneck. Customs delays cost us 50k/month."; monthly_budget=12000; timeline="immediate"; referral_source="LinkedIn"; client_id="acme_corp" },
  @{ first_name="Ryan"; last_name="Foster"; email="ryan@insurtech.io"; company_name="InsurTech Ventures"; industry="Finance"; business_description="Digital insurance brokerage managing policy documents for 2,000 clients."; pain_points="Policy renewals are missed. Claims documents are misfiled constantly."; monthly_budget=6000; timeline="immediate"; referral_source="Conference"; client_id="acme_corp" }
)

foreach ($lead in $intakeLeads) { Post $base_intake $lead }

# -------------------------------------------------
Write-Host ""
Write-Host "Document Intake submissions (10 records)" -ForegroundColor Cyan
# -------------------------------------------------

$docs = @(
  @{ client_id="acme_corp"; source_type="upload"; sender="ap@acme-corp.com"; subject="Invoice INV-2025-0088"; file_name="invoice_q2_2025.pdf"; file_type="pdf"; file_size=51200; document_text="INVOICE`nVendor: CloudHost Inc`nInvoice Number: INV-2025-0088`nDate: 2025-04-01`nBill To: Acme Corp`nServices: Cloud infrastructure Q2 2025`nSubtotal: 8400.00`nTax (8.5%): 714.00`nTotal Due: 9114.00`nDue Date: 2025-05-01`nPayment Terms: Net 30"; metadata=@{} },
  @{ client_id="acme_corp"; source_type="email"; sender="dr.patel@medcenter.org"; subject="Referral - Robert Kim DOB 1978-03-22"; file_name="referral_kim_robert.pdf"; file_type="pdf"; file_size=19800; document_text="PATIENT REFERRAL`nReferring Physician: Dr. Anjali Patel, MD`nNPI: 9876543210`nPatient Name: Robert Kim`nDate of Birth: 03/22/1978`nInsurance: Aetna PPO`nMember ID: AET-11223344`nDiagnosis: Type 2 Diabetes (E11.9)`nReferral To: Endocrinologist`nReason: Poor glucose control despite medication`nUrgency: Routine`nAuthorization: AUTH-2025-00512"; metadata=@{} },
  @{ client_id="acme_corp"; source_type="upload"; sender="legal@acme-corp.com"; subject="MSA - Acme Corp and DataSync Ltd"; file_name="msa_datasync_2025.docx"; file_type="docx"; file_size=42000; document_text="MASTER SERVICE AGREEMENT`nThis Master Service Agreement is entered into as of January 15, 2025 between DataSync Ltd and Acme Corp.`nServices: Data integration platform`nTerm: 24 months`nGoverning Law: State of New York`nAuto-renewal clause: Yes, 12-month increments`nLiability cap: 500000"; metadata=@{ requires_signature="true" } },
  @{ client_id="acme_corp"; source_type="upload"; sender="finance@acme-corp.com"; subject="W-2 2024 - Alan Coronado"; file_name="w2_2024_coronado.pdf"; file_type="pdf"; file_size=28000; document_text="FORM W-2 WAGE AND TAX STATEMENT 2024`nEmployer: Acme Corp`nEmployee: Alan Coronado`nSSN: XXX-XX-1234`nWages Tips: 95000.00`nFederal Tax Withheld: 18200.00`nState: TX`nState Wages: 95000.00"; metadata=@{} },
  @{ client_id="acme_corp"; source_type="email"; sender="court@district5.gov"; subject="Case No. 2025-CV-0042 Order to Show Cause"; file_name="order_2025cv0042.pdf"; file_type="pdf"; file_size=67000; document_text="IN THE DISTRICT COURT`nCase Number: 2025-CV-0042`nCourt: Fifth District Court`nFiling Date: March 10, 2025`nDocument Type: Order to Show Cause`nParties: Acme Corp v. TechRival Inc`nNext Hearing: April 15, 2025`nJudge: Hon. Patricia Monroe"; metadata=@{} },
  @{ client_id="acme_corp"; source_type="upload"; sender="onboarding@acme-corp.com"; subject="New Client Intake - Maria Santos"; file_name="intake_santos_maria.pdf"; file_type="pdf"; file_size=15400; document_text="CLIENT INTAKE FORM`nClient Name: Maria Santos`nContact Email: maria.santos@example.com`nContact Phone: 555-902-1100`nDate: February 28, 2025`nService Requested: Business Process Automation Consultation`nPreferred Contact: Email`nReferral Source: LinkedIn"; metadata=@{} },
  @{ client_id="acme_corp"; source_type="upload"; sender="vendor@supplierco.com"; subject="Receipt - Office Supplies March 2025"; file_name="receipt_office_march2025.pdf"; file_type="pdf"; file_size=8200; document_text="PURCHASE RECEIPT`nMerchant: OfficeDepot`nTransaction Date: March 5, 2025`nItems: Printer paper (2 cases), Toner cartridges (3x)`nSubtotal: 284.97`nTax: 23.62`nTotal: 308.59`nPayment Method: Corporate Visa ending 4892"; metadata=@{} },
  @{ client_id="acme_corp"; source_type="upload"; sender="compliance@acme-corp.com"; subject="Driver License - John Doe KYC"; file_name="id_doe_john_dl.pdf"; file_type="pdf"; file_size=12000; document_text="DRIVER LICENSE`nID Type: Driver License`nID Number: DL-TX-4456789`nFull Name: John Michael Doe`nDate of Birth: 1990-07-14`nExpiry Date: 2028-07-14`nState: Texas`nAddress: 123 Main St, Austin TX 78701"; metadata=@{ purpose="KYC verification" } },
  @{ client_id="acme_corp"; source_type="email"; sender="partners@realestate.com"; subject="Purchase Agreement - 450 Oak Ave"; file_name="purchase_agreement_450_oak.pdf"; file_type="pdf"; file_size=89000; document_text="REAL ESTATE PURCHASE AGREEMENT`nProperty Address: 450 Oak Avenue, Dallas TX 75201`nPurchase Price: 1250000`nClosing Date: June 15, 2025`nBuyer: Acme Corp Holdings LLC`nSeller: Oak Properties Ltd`nEarnest Money Deposit: 25000`nContingencies: Financing, Inspection"; metadata=@{} },
  @{ client_id="acme_corp"; source_type="webhook"; sender="system@integrator.io"; subject="Document batch 2025-04-10"; file_name="scan_20250410_batch.tiff"; file_type="tiff"; file_size=145600; document_text="Page 1 of 3`nReference Number: XK-449921`nDate: April 10 2025`nTo Whom It May Concern,`nPlease find attached the requested materials per our discussion.`nBest regards,`nJ. Morrison"; metadata=@{ batch_id="BATCH-2025-0410"; page_count=3 } }
)

foreach ($doc in $docs) { Post $base_doc $doc }

# -------------------------------------------------
Write-Host ""
Write-Host "Appointment Scheduling (12 records)" -ForegroundColor Cyan
# -------------------------------------------------

$appts = @(
  @{ client_id="acme_corp"; source_type="form"; request_type="book"; contact_name="Jane Smith"; contact_email="jane.smith@example.com"; service_type="consultation"; appointment_type="initial_consultation"; requested_time="2026-06-02T10:00:00Z"; timezone="America/Chicago"; notes="First visit, referred by Dr. Adams" },
  @{ client_id="acme_corp"; source_type="internal"; request_type="book"; contact_name="Bob Martinez"; contact_email="bob.martinez@example.com"; service_type="follow_up"; appointment_type="follow_up"; requested_time="2026-06-03T14:00:00Z"; timezone="America/Chicago" },
  @{ client_id="acme_corp"; source_type="form"; request_type="book"; contact_name="Linda Park"; contact_email="linda.park@example.com"; service_type="consultation"; appointment_type="initial_consultation"; requested_time="2026-06-04T09:00:00Z"; timezone="America/New_York" },
  @{ client_id="acme_corp"; source_type="crm"; request_type="book"; contact_name="David Thompson"; contact_email="dthompson@company.com"; service_type="demo"; appointment_type="product_demo"; requested_time="2026-06-05T15:00:00Z"; timezone="America/Chicago" },
  @{ client_id="acme_corp"; source_type="form"; request_type="book"; contact_name="Aisha Okonkwo"; contact_email="aisha@edtech.co"; service_type="onboarding"; appointment_type="onboarding_session"; requested_time="2026-06-09T11:00:00Z"; timezone="America/Los_Angeles" },
  @{ client_id="acme_corp"; source_type="form"; request_type="book"; contact_name="Carlos Reyes"; contact_email="carlos.reyes@example.com"; service_type="support"; appointment_type="technical_support"; requested_time="2026-06-10T13:30:00Z"; timezone="America/Chicago"; notes="Urgent - production issue" },
  @{ client_id="acme_corp"; source_type="form"; request_type="reschedule"; contact_name="Maria Santos"; contact_email="maria.santos@example.com"; service_type="consultation"; appointment_type="initial_consultation"; requested_time="2026-06-11T10:00:00Z"; timezone="America/Chicago"; notes="Rescheduling from June 2nd" },
  @{ client_id="acme_corp"; source_type="email"; request_type="cancel"; contact_name="Kevin Brooks"; contact_email="kevin@tinyshop.net"; service_type="consultation"; requested_time="2026-06-03T09:00:00Z"; timezone="America/New_York"; notes="No longer needed" },
  @{ client_id="acme_corp"; source_type="form"; request_type="book"; contact_name="Priya Patel"; contact_email="priya@financelogic.io"; service_type="consultation"; appointment_type="initial_consultation"; requested_time="2026-06-12T14:00:00Z"; timezone="America/New_York" },
  @{ client_id="acme_corp"; source_type="internal"; request_type="book"; contact_name="Ryan Foster"; contact_email="ryan@insurtech.io"; service_type="demo"; appointment_type="product_demo"; requested_time="2026-06-13T10:00:00Z"; timezone="America/Chicago" },
  @{ client_id="acme_corp"; source_type="form"; request_type="book"; contact_name="Nadia Sokolova"; contact_email="nadia@mfg.ru"; service_type="consultation"; appointment_type="enterprise_consultation"; requested_time="2026-06-16T16:00:00Z"; timezone="America/Chicago"; notes="Enterprise inquiry - international client" },
  @{ client_id="acme_corp"; source_type="form"; request_type="book"; contact_name="Elena Vasquez"; contact_email="evasquez@lawgroup.com"; service_type="onboarding"; appointment_type="onboarding_session"; requested_time="2026-06-17T09:00:00Z"; timezone="America/Los_Angeles" }
)

foreach ($appt in $appts) { Post $base_appt $appt }

Write-Host ""
Write-Host "-------------------------------------------------" -ForegroundColor DarkGray
Write-Host "Seeding complete: $($global:ok) succeeded, $($global:err) failed" -ForegroundColor White
