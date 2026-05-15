$body = '{"first_name":"Sarah","last_name":"Chen","email":"sarah.chen@techcorp.com","company_name":"TechCorp Solutions","industry":"SaaS","pain_points":"Our onboarding takes 3 weeks manually. We need it automated to under 48 hours.","monthly_budget":5000,"timeline":"immediate"}'

Invoke-RestMethod -Method POST -Uri "http://localhost:5678/webhook/customer-intake" -ContentType "application/json" -Body $body
