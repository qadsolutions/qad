# Business Description
# Private RAG Agent Platform for Small Service Businesses

*This file is a living document. It will evolve into the project README.*

---

## What This Is

A private, multi-tenant AI agent platform that gives small service businesses their
own domain-aware knowledge system. Each client gets an AI agent that knows their
pricing, service area, policies, and workflows — without their data ever touching a
public AI service.

The owner (you) manages all clients from a central admin dashboard. Clients get a
secure portal to interact with their agent and upload their own documents.

---

## The Problem

Small service businesses — plumbers, HVAC techs, junk removal companies, auto repair
shops — lose leads and waste staff time answering the same questions on repeat:

- "Do you service my zip code?"
- "How much does it cost to remove a couch?"
- "Are you available Saturday?"
- "What do I need to bring for my appointment?"

Their knowledge lives in the owner's head, in a notes app, or scattered across text
messages. Generic AI tools like ChatGPT don't know any of it. So the owner keeps
answering the same calls, the front desk keeps reading from the same mental script,
and new employees take weeks to get up to speed.

Missed after-hours calls go to voicemail. Customers call a competitor.

---

## The Solution

A RAG agent (Retrieval-Augmented Generation — an AI that answers questions from a
private knowledge base rather than guessing) built from each client's own documents:

- Price lists
- Service area rules
- FAQs
- Standard operating procedures
- Scheduling logic
- Anything the owner knows that a customer or employee might ask

The agent handles customer Q&A, after-hours lead capture, staff onboarding support,
and intake workflows — all using that business's actual information, not generic AI
guesses.

---

## Target Customers

Owner-operated service businesses with 2–30 employees and high call volume:

| Industry | Primary pain |
|---|---|
| Junk removal | Pricing by volume/item, service area, what they take |
| Auto repair | Labor/parts pricing, scheduling, status updates |
| Plumbing | Emergency vs. scheduled, pricing, service area |
| HVAC | Seasonal demand, emergency dispatch, pricing |
| Pest control | Service area, pricing by pest type, retreat policies |
| Landscaping | Service types, availability, seasonal schedules |

**The buyer:** The owner or ops manager. They feel the pain directly and make the
purchasing decision. No procurement process, no IT department.

---

## Business Model

| Component | Range |
|---|---|
| Setup / implementation fee | $2,500 – $10,000 |
| Monthly management fee | $300 – $2,000/month |
| Optional add-ons | Voice agent, CRM integration, multi-agent workflows |

Monthly fee covers hosting, knowledge base maintenance, prompt tuning, and updates.
The client's knowledge layer is embedded in the system — switching cost is high.

---

## What Makes It Defensible

- **Private by design.** Client data never goes to OpenAI or any public API. This
  matters to small business owners who don't want their pricing and policies leaked.
- **Multi-tenant isolation.** Each client's data, documents, and conversations are
  physically separated. No cross-contamination.
- **Switching cost.** The agent is built from the client's own knowledge. Leaving
  means rebuilding that knowledge layer elsewhere. Most won't.
- **Managed service.** The owner handles all the technical complexity. The client
  just uses it.

---

## Current Status

- Technical infrastructure: existing Docker stack (PostgreSQL, n8n, Ollama, React)
  covers most of the deployment layer
- Product: not yet built
- Customers: warm contacts identified (junk removal owner, auto repair shop)
- Stage: pre-product, customer discovery phase

---

## Warm Contacts (Customer Discovery — Do These First)

Before building:

1. **Junk removal company owner** (friend) — call this week.
   Ask: "Walk me through what happens when someone calls to get a quote."

2. **Auto repair shop** (friend who works there) — text this week.
   Ask if they'll talk or intro you to the owner. Same question.

Do not pitch. Just listen. What they say is the product spec.

---

## Discovery Email Templates

### Warm — Junk Removal Owner
> Subject: Quick favor — can I pick your brain about the business?
>
> Hey [Name], I'm working on something new and before I build anything I want to
> understand how a business like yours actually runs. Would you be up for a
> 15-minute call this week? Just want to ask a few questions about how you handle
> calls and quotes — nothing to sell, I promise.
>
> Alan

### Warm — Auto Repair (through friend)
> Subject: Quick intro ask
>
> Hey [Name], I'm doing research on how auto shops handle customer calls — pricing
> questions, scheduling, the stuff your team probably answers on repeat. Would you
> be comfortable introducing me to the owner for a 10-minute call? Not pitching
> anything — just trying to learn before I build something.
>
> Alan

### Cold — Any Industry (from scraped leads)
> Subject: Quick question about [industry] calls
>
> Hi [Name], I'm doing research on how [industry] businesses handle day-to-day
> customer questions — service areas, pricing, scheduling. Not pitching anything.
> Just trying to understand the workflow. Would you be open to 10 minutes this week?
>
> Alan Coronado

---

## Cold Lead Pipeline (ScrapeGraphAI)

For finding contacts beyond warm network:

1. Search Yelp, Angi, Google Maps, BBB for target industries in a specific city
2. Collect business website URLs (50–100 per industry per city)
3. Run ScrapeGraphAI on each URL: "Extract business name, owner name, phone, email"
4. Verify emails with Hunter.io (free tier)
5. Send cold email template above
6. Track: Business | Industry | Contacted | Replied | Call scheduled | Notes

Run cold outreach only after warm contact calls are complete.

---

## Build Order (When Ready)

1. Generic RAG knowledge agent — web chat, PDF/text ingestion, accurate retrieval
2. Wrap intake flow around it — lead capture, qualification, scheduling handoff
3. First demo with junk removal contact
4. Multi-tenant isolation — separate vector namespace per client
5. Client portal — secure login, document upload, chat interface
6. Owner admin dashboard — tenant management, logs, config
7. Cold outreach to scraped leads
8. Sign first 2–3 manual clients
9. Automated onboarding platform (after learning the repeatable pattern)

Full technical architecture and build spec in `CLAUDE.md`.

---

## Key Questions Still Open

1. What is the most painful workflow in junk removal — quoting, after-hours, scheduling?
2. What is the most painful workflow in auto repair?
3. Will owners pay $300–500/month or does resistance appear below that?
4. What document quality do these businesses actually have?
5. Is the moat the knowledge layer, the workflow integrations, or both?
6. After first 3 clients — is there a reseller/agency channel worth testing?
