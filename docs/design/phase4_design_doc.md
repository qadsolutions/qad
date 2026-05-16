# Phase 4 — Client Dashboard Design
## QAD Automation Platform · Client Portal

---

## 1. Product Vision

The QAD Client Portal is not a reporting tool. It is a **live operational window** into the automation layer running on behalf of each client. Every screen should answer one of three questions:

- **What is happening?** — The automation is working, here is what it did.
- **Is anything wrong?** — Here is what needs your attention, and why.
- **Is it worth it?** — Here is the value the automation has produced.

The portal earns trust through visibility. Clients who can see that documents are being processed, leads are being qualified, and appointments are being scheduled without effort will feel the value of the product without needing a sales conversation. The dashboard is a retention mechanism, a trust signal, and a proof of value all in one.

The experience should feel like having a dedicated operations team visible through a glass wall — competent, active, and under control.

---

## 2. UI/UX Strategy

### Guiding Principles

**1. Progressive disclosure over information dump.**
Show the most important thing first. Put detail behind a click, not in front of it. A client opening the dashboard should see their operational status in under 3 seconds without reading a paragraph.

**2. Status is everything.**
Every item in the interface has a status. Success, in-progress, needs attention, failed. The design language should make status instantly readable through color, shape, and position — never through text alone.

**3. Exceptions feel manageable, not alarming.**
When something needs human review, the UI should explain what happened, why it matters, and what to do next. The tone is calm and operational, not urgent or error-heavy.

**4. The automation should feel active, not static.**
Timestamps, recent activity counts, and live status pulses remind clients that work is happening continuously. The dashboard should feel alive even between user sessions.

**5. Drill down without getting lost.**
Every detail view has a clear path back. The navigation breadcrumb, the sidebar state, and the drawer close button are always present. No dead ends.

**6. Actionable over informational.**
Every screen should have a primary action or a clear next step. If there is nothing to do, the empty state should say so and explain what to expect.

### User Mental Model

The client user is an operations manager, business owner, or executive assistant. They:
- Check the dashboard 1-3x per day
- Want exceptions surfaced immediately
- Do not want to understand n8n or PostgreSQL
- Value clean summaries over raw data
- Need to trust the system before delegating fully

The dashboard should support the transition from "I'm not sure I trust this" to "I don't need to check, it just works."

---

## 3. Visual Design Direction

### Design Style

**Primary style: Data-Dense Minimalism**
Clean Swiss-grid structure with intentional information density. Cards use soft elevation (not flat, not dramatic). Background is near-white. One strong accent color drives hierarchy. Status colors are used sparingly and consistently.

**Secondary style: Soft UI Evolution**
Cards have subtle multi-layer shadows (not neumorphic, not flat). Border radius 10px standard. Borders at slate-200. Hover states shift shadow + background together, 200ms ease.

### Color System

```
Background base:    #F8F9FB   (near-white, not pure white — reduces eye fatigue)
Surface (cards):    #FFFFFF
Border default:     #E2E8F0   (slate-200)
Border subtle:      #F1F5F9   (slate-100)

Text primary:       #0F172A   (slate-950)
Text secondary:     #475569   (slate-600)
Text muted:         #94A3B8   (slate-400)
Text on dark:       #F8FAFC   (slate-50)

Accent primary:     #6366F1   (indigo-500)  — links, active states, primary CTA
Accent hover:       #4F46E5   (indigo-600)
Accent light:       #EEF2FF   (indigo-50)   — badge backgrounds, highlights

Status — Success:   #10B981   (emerald-500)
Status — Warning:   #F59E0B   (amber-500)
Status — Error:     #F43F5E   (rose-500)
Status — Info:      #0EA5E9   (sky-500)
Status — Neutral:   #94A3B8   (slate-400)

Sidebar dark bg:    #0F172A   (slate-950)
Sidebar text:       #CBD5E1   (slate-300)
Sidebar active:     #6366F1   (indigo-500)
Sidebar active bg:  rgba(99,102,241,0.12)
```

### Status Badge System

Status badges are pill-shaped, 20px height, 10px padding horizontal, 500 weight text, 12px size.

```
hot / warm lead:          emerald bg-10% / emerald-700 text
disqualified / rejected:  rose bg-10% / rose-700 text
pending_review:           amber bg-10% / amber-700 text
confirmed:                emerald bg-10% / emerald-700 text
invoice / auto_process:   indigo bg-10% / indigo-700 text
error / failed:           rose bg-10% / rose-700 text
cancelled:                slate bg-10% / slate-600 text
in_progress:              sky bg-10% / sky-700 text
```

Status color is never used for decoration. Reserved strictly for operational meaning.

### Typography

**Font pairing: Poppins + Inter**
Poppins for display, section titles, KPI numbers. Inter for all body copy, labels, table data.
Inter is chosen over Open Sans for its superior data rendering and numeric tabular spacing.

```
Display (KPI numbers):  Poppins 36-48px, 700
Page titles:            Poppins 24px, 600
Section headers:        Poppins 18px, 600
Card titles:            Inter 15px, 600
Body / labels:          Inter 14px, 400-500
Table data:             Inter 13px, 400
Captions / meta:        Inter 12px, 400, slate-400
Uppercase labels:       Inter 11px, 600, letter-spacing 0.08em, slate-500
```

Line height: 1.6 for body. 1.2 for display. 1.4 for card titles.

### Spacing Scale

8px base unit.

```
xs:   4px
sm:   8px
md:   16px
lg:   24px
xl:   32px
2xl:  48px
3xl:  64px
4xl:  96px
```

Cards: 24px internal padding. Section gap: 24px. Page padding: 32px horizontal.

### Elevation / Shadow System

```
Level 0 (flat):    no shadow
Level 1 (card):    0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)
Level 2 (raised):  0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.05)
Level 3 (overlay): 0 10px 15px rgba(0,0,0,0.10), 0 4px 6px rgba(0,0,0,0.06)
Level 4 (modal):   0 20px 25px rgba(0,0,0,0.12), 0 10px 10px rgba(0,0,0,0.04)
```

Cards rest at Level 1. Hover lifts to Level 2. Drawers at Level 3. Modals at Level 4.

### Border Radius

```
Button, badge, tag:   6px
Card, input:          10px
Modal, drawer:        12px
Avatar, pill:         999px (full round)
```

### Icon System

Lucide React — consistent 20px size for sidebar nav, 16px for inline/compact, 24px for feature icons.
Never use emoji as icons. Never mix icon libraries.

---

## 4. Information Architecture

```
QAD Client Portal
│
├── Overview                    /dashboard
│   ├── KPI strip
│   ├── Automation health grid
│   ├── Open exceptions panel
│   ├── Recent activity feed
│   └── Upcoming appointments
│
├── Automations                 /automations
│   ├── Customer Intake         /automations/intake
│   ├── Document Processing     /automations/documents
│   └── Appointment Scheduling  /automations/appointments
│
├── Activity                    /activity
│   └── Full timeline feed with filters
│
├── Documents                   /documents
│   ├── All documents           (filterable by type, status, date)
│   └── Document detail         /documents/:id
│
├── Tasks & Follow-Ups          /tasks
│   ├── Open                    (pending human input)
│   ├── In Progress
│   └── Completed
│
├── Calendar                    /calendar
│   ├── Month / Week / Day views
│   └── Appointment detail      /calendar/:id
│
├── Exceptions                  /exceptions
│   ├── Open
│   ├── In Review
│   └── Resolved
│
├── Reports                     /reports
│   ├── Summary                 (value proof, time saved)
│   ├── Automations             (per-workflow metrics)
│   ├── Documents               (volume, classification breakdown)
│   └── Appointments            (scheduling metrics)
│
└── Settings                    /settings
    ├── Profile
    ├── Notifications
    ├── Integrations
    └── Branding (operator-configurable)
```

**Navigation structure: Fixed sidebar + top bar.**
9 top-level nav items. Active state uses indigo highlight. Sidebar collapses to icon-only on tablet.

---

## 5. Screen-by-Screen Layout

---

### 5.1 Overview (Main Dashboard)

**Purpose:** Answer "what is happening right now, and is anything broken" in under 5 seconds.

**Layout (1440px):**
```
┌─ Sidebar (240px fixed) ───┬─ Main content area ──────────────────────┐
│                           │  Top bar: breadcrumb | date | notif | avatar│
│  [Logo]                   ├──────────────────────────────────────────────┤
│                           │  "Good morning, Acme Corp"   [Last updated 2m]│
│  Overview          ●      │                                              │
│  Automations              │  ── KPI Strip (4 cards, equal width) ──────  │
│  Activity                 │  [Total Runs] [Avg Success Rate] [Items Proc] [Open Exceptions]│
│  Documents                │                                              │
│  Tasks                    │  ── 2-column layout ────────────────────────  │
│  Calendar                 │  Left col (60%)           Right col (40%)    │
│  Exceptions       [3]     │  Automation Health        Open Exceptions    │
│  Reports                  │  (3 automation cards)     (scrollable list)  │
│  Settings                 │                                              │
│                           │  ── Full width ──────────────────────────── │
│  [Client logo]            │  Recent Activity (last 10 events, timeline)  │
│  [User avatar]            │                                              │
│  v1.0                     │  ── 2-column ────────────────────────────── │
└───────────────────────────│  Upcoming Appointments    Recent Documents   │
                            └──────────────────────────────────────────────┘
```

**KPI Cards (4 across):**
Each card:
- Large Poppins number (36px, 700)
- Label below (Inter 12px, uppercase, slate-500)
- Trend indicator (small arrow + % vs last 7 days)
- Subtle left border accent for color coding

Cards: Total Runs (indigo), Success Rate (emerald), Items Processed (sky), Open Exceptions (amber/rose depending on count).

**Automation Health Grid (3 cards):**
One card per automation. Each shows:
- Automation name + icon
- Status pill (Active / Degraded / Error)
- Last run timestamp
- Success rate sparkline (7-day mini area chart, 60px tall)
- Last run outcome label
- "View details" link

**Open Exceptions Panel:**
- Compact list, max 5 visible, "View all" footer link
- Each row: severity dot | automation name | short description | time ago
- Row hover: background shift + cursor pointer
- No exceptions state: green check + "All clear — no open exceptions"

**Recent Activity:**
- Timeline format, icon per event type, 10 items
- Event types use distinct icons: mail, file, calendar, user, alert, check
- Each row: icon | event label | entity name | time | status badge
- "View full activity" at bottom

**Upcoming Appointments (next 5):**
- Date pill | contact name | service type | status | time
- Today's appointments highlighted with soft indigo border

---

### 5.2 Automations

**Purpose:** Deep status view of all three automations.

**Layout:**
Top: Tab bar — All | Customer Intake | Document Processing | Appointment Scheduling

Each automation card (full width):
```
┌──────────────────────────────────────────────────────────────────────┐
│  [Icon] Customer Intake & Qualification        ● Active    [Details] │
│  Last run: 4 minutes ago  |  Today: 23 runs  |  7-day success: 94%   │
│                                                                      │
│  [Sparkline area chart — 7 days of run volume and success rate]      │
│                                                                      │
│  Trigger: Webhook (POST /webhook/customer-intake)                    │
│  Connected: PostgreSQL · Gmail · Ollama AI                           │
│                                                                      │
│  Recent outputs:                                                     │
│  ● hot     James Reyes    consulting   $8,200/mo   2m ago            │
│  ● warm    Priya Nair     healthcare   $3,400/mo   14m ago           │
│  ● review  Unknown Corp   —            —           31m ago           │
└──────────────────────────────────────────────────────────────────────┘
```

**Status pills:**
- Active: emerald dot + text
- Degraded: amber dot + text (recent partial failures)
- Error: rose dot + text (last run failed)
- Paused: slate dot + text

**Automation detail page (/automations/intake):**
- Full-width header with status + last run
- Tabbed content: Overview | Run History | Configuration | Errors
- Run history: table with execution_id, started_at, duration, status, outcome
- Configuration: read-only view of trigger, connections, routing rules
- Errors: filterable list of workflow_errors rows

---

### 5.3 Activity Timeline

**Purpose:** Full operational history, readable and scannable.

**Layout:**
- Left: Filter sidebar (160px) — filter by automation, event type, date range, status
- Right: Timeline feed

**Filter sidebar:**
- Automation: All | Intake | Documents | Appointments
- Event type: All | Lead | Document | Appointment | Error | Review | System
- Date range: Today | Last 7 days | Last 30 days | Custom
- Status: All | Success | Warning | Error | Review

**Timeline feed:**

Events are grouped by date header (Today, Yesterday, May 10, etc.).

Each event row:
```
  [Event icon]  [Event title in 15px 600]               [Time ago]
                [Entity detail — name, email, or file]
                [Status badge]  [Automation name tag]
```

Event icons by type:
- Lead qualified: user-check (indigo)
- Document processed: file-check (sky)
- Appointment confirmed: calendar-check (emerald)
- Exception raised: alert-triangle (amber)
- Error: x-circle (rose)
- Email sent: mail (slate)
- Manual review completed: eye (indigo)

Long lists: virtual scroll. Load 50 at a time. "Load more" at bottom, not infinite scroll (avoids confusion about position).

---

### 5.4 Documents

**Purpose:** Show that files are being handled intelligently, not disappearing into a black box.

**Layout:**
- Top: search bar + filters (file type, status, date, classification)
- Body: card grid (3 columns desktop, 2 tablet) or table toggle

**Document card:**
```
┌──────────────────────────────────────┐
│  [File type icon]  invoice_march.pdf │
│                                      │
│  Invoice  ·  0.92 confidence         │
│  → Accounts Payable                  │
│                                      │
│  Acme Corp · May 11, 2026            │
│  ● auto_process                      │
└──────────────────────────────────────┘
```

**Document detail drawer (slides in from right, 480px):**
- File name + type icon (large)
- Status + confidence score with visual bar
- Classification label + routing destination
- Extracted fields section: key-value pairs (Invoice #, Vendor, Total, Due Date)
- Linked workflow run
- Processing timeline: received → classified → routed → logged
- Action buttons: Request Re-review | Download | View in full

**Empty state:**
"No documents yet. When files are submitted, they will appear here with classification and routing details."
Icon: file with dashed border. No junk text. No "Get started" in place of explanation.

---

### 5.5 Tasks and Follow-Ups

**Purpose:** Make it obvious what the automation handled and what still needs human input.

**Layout:**
- Three-column status board: Open | In Progress | Completed
- Or: List view with tab filter

Each task card:
- Task type badge (Review | Approval | Follow-up | Escalation)
- Short description
- Source automation
- Assigned to (if applicable)
- Due date or created time
- Priority indicator (High / Normal / Low — dot color)

**Task detail drawer:**
- Full description
- Context: which automation created it, what triggered it
- Related record (lead, document, or appointment link)
- Activity thread (comments, status changes)
- Action: Mark complete | Reassign | Add note

**Empty state (Open tasks):**
"No open tasks — the automation is handling everything right now."
Green check icon. Encouraging, not empty.

---

### 5.6 Calendar and Appointments

**Purpose:** Connect scheduling activity with the rest of the automation platform.

**Layout:**
- Full-width calendar in month view by default
- Week / Day toggle in top-right
- Right sidebar: Today's appointments list (240px)

Appointment events on calendar:
- Color coded by status: confirmed (emerald), pending (amber), cancelled (slate strikethrough)
- Click opens appointment detail drawer

**Appointment detail drawer:**
- Contact name + email
- Service type + requested time + timezone
- Status + auto-confirmed indicator
- Reminder sequence: shows planned reminders as timeline
- Conflict indicator (if any overlap)
- Linked intake record (if same contact exists in intake_log)
- Actions: Confirm | Reschedule | Cancel | Add note

**Conflicts section (right sidebar):**
If any conflicts exist, appear as amber banner in sidebar with link to Exceptions.

**Calendar sync status:**
Footer bar below calendar: "Calendar sync active · Last updated 3 minutes ago" or amber if sync failed.

---

### 5.7 Exceptions and Reviews

**Purpose:** Surface every item needing human attention in a calm, actionable format.

**This is the trust section.** Clients who see exceptions handled clearly trust the system more, not less.

**Layout:**
- Tab bar: Open | In Review | Resolved
- Each tab shows a filtered list

Exception row structure:
```
┌─────────────────────────────────────────────────────────────────────┐
│  ● HIGH   [Automation tag]   [Short title]                [5m ago] │
│           Description of what happened and why it needs review      │
│           [Take Action]  [Assign]  [Dismiss]                        │
└─────────────────────────────────────────────────────────────────────┘
```

**Exception types and UX copy tone:**

| Type | Title | Tone |
|---|---|---|
| Low AI confidence | "Document classification needs review" | Calm, informational |
| Validation failure | "Appointment request missing required fields" | Factual, no blame |
| Integration failure | "Email notification not sent — retrying" | Reassuring |
| Duplicate lead | "Existing contact submitted again" | Neutral |
| Outside hours | "Appointment request received outside business hours" | Explanatory |

**Exception detail drawer:**
- What happened (1-2 sentence plain language summary)
- Technical detail (expandable — not shown by default)
- Recommended action (specific, one-line guidance)
- Related record link
- Resolution options: Approve | Reject | Reassign | Dismiss with note

**Resolved tab:**
Read-only history. Shows who resolved, when, what action was taken.

**Empty state (Open):**
Large green check. "No exceptions right now. Everything is processing normally."

---

### 5.8 Reports and Outcomes

**Purpose:** Prove value. This screen is the ROI conversation in dashboard form.

**Layout:**
- Date range selector (top right): Last 7d | Last 30d | Last 90d | Custom
- Summary metrics row (3 large cards)
- Automation-specific sections below

**Summary cards (3):**
1. Total items processed (with change vs previous period)
2. Automation success rate (%)
3. Estimated time saved (hours — calculated from run count × avg time per manual task)

**Per-automation sections:**

**Customer Intake:**
- Total leads: {n}
- By tier: Hot {n} | Warm {n} | Disqualified {n} | In Review {n}
- Chart: Bar chart, tier breakdown
- Top source types
- Average qualification score trend (line, 30 days)

**Document Processing:**
- Total documents: {n}
- By classification: stacked bar chart (10 document types)
- Auto-processed vs human review ratio: donut chart
- Average confidence score trend (line)
- Documents by routing destination: horizontal bar

**Appointment Scheduling:**
- Total appointments: {n}
- By status: confirmed, rescheduled, cancelled, pending
- Auto-confirmed rate: large percentage stat
- Appointments by service type: bar
- Booking source breakdown (internal / form / crm): pie or donut

**Export:**
Top right: "Export Report" button → PDF or CSV. Generates a clean single-page summary.

Charts library: Recharts (React-native, lightweight, composable). All charts include hover tooltips and table fallbacks for accessibility.

---

### 5.9 Settings

**Purpose:** Allow clients to configure notifications and view integration status. Operator-only: branding and client configuration.

**Sections:**

**Profile** — name, email, notification preferences
**Notifications** — per-event type toggles (exception raised, weekly report, appointment changes)
**Integrations** — connected systems status: PostgreSQL (internal), Gmail, Ollama, Calendar
**Appearance** — if white-label is enabled, client can set their logo and primary color
**Danger zone** — data export, account deactivation (operator-only visible)

---

## 6. Component Design Guidance

### Top Bar (64px height)
- Left: page breadcrumb (Home / Section / Detail)
- Center: page title (bold 18px)
- Right: notification bell (badge count) + client name + avatar dropdown
- Background: white, 1px border-bottom slate-200
- Sticky on scroll

### Sidebar (240px fixed, collapsible to 64px)
- Dark background: #0F172A
- Logo area top: 64px height, client logo or QAD wordmark
- Nav items: icon (20px) + label, 44px height, 12px horizontal padding
- Active item: indigo-500 text + indigo bg at 12% opacity + left border 3px indigo
- Hover: slate-800 background, slate-200 text, 200ms
- Notification badge on Exceptions: rose pill, count
- Bottom section: user avatar + name (truncated) + settings icon
- Collapse toggle: chevron at bottom of nav section

### KPI Cards
- White background, Level 1 shadow, 10px radius
- Large number top (Poppins 36px 700)
- Label below (Inter 12px uppercase slate-500)
- Trend row: arrow icon + percentage + period label (12px slate-400)
- Trend positive: emerald arrow-up. Negative: rose arrow-down. Neutral: dash.
- Left border accent (4px, colored per metric type)
- Min-height: 120px

### Automation Status Cards
- White background, Level 1 shadow, 10px radius
- Header row: icon + name + status pill + View button
- Meta row: last run + today count + success rate (separator-divided, slate-400 text)
- Sparkline: 60px tall, indigo fill at 15%, indigo line 2px, no axes
- Recent outputs: 3-row compact list, status dot + name + tier + time

### Activity Feed Items
- No card wrapper — items live in a bordered-left timeline (2px indigo-200 line)
- Event dot on the line (8px, colored by event type)
- Icon in a 32px rounded square (colored bg at 10% + icon at full)
- Title 14px 600, description 13px slate-600, time 12px slate-400 right-aligned
- Hover: full row bg slate-50, 150ms

### Exception Rows
- White card, Level 1 shadow, left border 4px (rose for high, amber for medium, slate for low)
- Severity dot + label (HIGH / MEDIUM / LOW)
- Title 15px 600, description 13px slate-500
- Action buttons (ghost style) at bottom right
- "Take Action" primary text link in indigo

### File / Document Cards
- White card, Level 1 → Level 2 on hover, 10px radius
- File type icon (colored: PDF = rose, DOCX = sky, XLSX = emerald, etc.)
- Classification label + confidence bar (thin, 4px, colored by confidence: emerald ≥0.80, amber 0.60-0.80, rose <0.60)
- Routing destination with arrow icon
- Status badge bottom right
- Hover: shadow lifts, thin indigo border appears

### Buttons
- Primary: indigo-500 bg, white text, 10px radius, 44px height, 16px h-padding
- Secondary: white bg, slate-300 border, slate-700 text
- Ghost: transparent, indigo-600 text, no border
- Destructive: rose-500 bg, white text
- All: 200ms transition on hover (darken 10%), disabled state at 50% opacity, loading state replaces label with spinner
- cursor-pointer on all interactive elements

### Status Pills / Badges
- 20px height, 6px radius, 10px h-padding
- 12px Inter 600
- Color pair: 10% opacity bg + full tone text (same hue)
- Never use status color for decoration

### Empty States
- Centered illustration (simple line icon, 80px, slate-300)
- Title: 16px 600, slate-700
- Description: 14px slate-400, max 2 lines
- CTA if applicable: primary button
- No placeholder data, no "Lorem ipsum"

### Loading States
- Skeleton screens — same layout as loaded state
- Use `animate-pulse` on placeholder blocks
- Colors: slate-200 → slate-100 pulse
- Show immediately on mount, never a blank screen

### Detail Drawers (right panel, 480px)
- Slides in from right, 300ms ease-out
- Backdrop overlay: black 20% opacity
- Close button top-right (X icon, 44px touch target)
- Header: entity name + type badge
- Scrollable body
- Sticky footer: primary + secondary actions
- Never full-screen on desktop (user should still see the list behind)

### Modals (for confirmations and destructive actions only)
- Center-screen, max 480px wide
- Level 4 shadow
- Title + description + button row (Cancel left, primary right)
- Backdrop: black 40% opacity
- ESC key to close

### Notification Bell
- Rose badge (count, max "9+")
- Dropdown panel: 360px, max 6 items visible, scroll for more
- Each item: event icon + title + time
- Mark all read link at top
- View all link at bottom → /activity

### Filters and Search
- Search: full-width input with magnifier icon left, 44px height, 10px radius
- Filters: horizontal pill row below search
- Active filter pill: indigo bg-10% + indigo text + X to remove
- Inactive filter: white + slate-300 border + slate-600 text
- Filter change: instant update with 150ms fade transition

---

## 7. Interaction Patterns

### Navigation
- Sidebar link click: instant route change, active state applies immediately
- Mobile: sidebar becomes bottom sheet, hamburger in top-left
- Breadcrumb is always correct and clickable

### Hover
- Cards: shadow lift (Level 1 → Level 2), 200ms
- Rows: background shift to slate-50, 150ms
- Buttons: darken, 200ms
- Links: underline appears, color shifts to indigo-600

### Drawer open/close
- Open: slides from right, backdrop fades in, 300ms ease-out
- Close: slides out right, backdrop fades out, 250ms ease-in
- ESC closes. Backdrop click closes. X closes.

### Loading
- Page-level data: skeleton screens immediately on mount
- Inline updates (polling): spinner on the affected section only, never full-page
- Button actions: button goes to loading state (spinner replaces label, disabled), resolves within 1-3s max

### Status polling
- Overview and activity feed: poll every 30 seconds for updates
- When new data arrives: animate-in the new items at top of feed (slide down from top, 300ms)
- No intrusive notifications — a subtle count badge on the activity section label

### Empty → populated transition
- When data arrives after empty state: fade out empty state, fade in content, 200ms
- Not a jarring replacement — feels natural

### Scroll behavior
- Sidebar: fixed, never scrolls
- Top bar: sticky, never scrolls
- Page content: scrollable, starts below top bar
- Long lists: virtual scroll above 200 items
- Tables: sticky header row on scroll

### Microinteractions
- Status badge on exception: subtle pulse animation (scale 1 → 1.05 → 1, 2s loop) when severity is HIGH and unread
- Automation health card: success rate number counts up from 0 on first load (400ms)
- KPI cards: numbers count up from 0 on first load (600ms, easeOut)
- New activity item: slides in from top with 200ms ease

---

## 8. Empty / Loading / Error States

### Global loading (initial page load)
- Full sidebar renders immediately (no skeleton)
- Main content: skeleton layout matching the target screen
- Top bar renders immediately with user name

### Empty states (per section)

| Section | Empty title | Description |
|---|---|---|
| Overview / Activity | No activity yet | Automations will appear here once the first workflow runs. |
| Exceptions | All clear | No exceptions right now. Everything is processing normally. |
| Documents | No documents yet | Files submitted through the automation will appear here with classification details. |
| Tasks | Nothing pending | The automation is handling everything. Open tasks will appear here when human input is needed. |
| Calendar | No appointments | Scheduled appointments will appear here once bookings are confirmed. |
| Reports | No data yet | Report data will appear after the first workflow runs. Check back after your first submission. |

### Error states (data fetch failure)

Each section: Replace content area with:
- Alert icon (rose)
- "Unable to load [section name]"
- "This may be a temporary issue. Try refreshing the page." (for transient)
- Retry button (ghost, indigo text)
- Never show a stack trace or raw error to the client

### Partial data states
If one of 3 automations fails to load its metrics: show the other 2 normally. Show an amber inline banner on the failed card: "Could not load metrics for this automation."

---

## 9. Branding and Theming Guidance

### Default theme (no white-label)
- QAD wordmark in sidebar top
- Indigo primary throughout
- Neutral slate greys for everything else
- "Powered by QAD" subtle footer in sidebar (10px, slate-600)

### Client-configurable theming
Operators can set per-client:
- **Client logo** — shown in sidebar top, max 160x40px, PNG/SVG
- **Primary color** — replaces indigo-500 throughout (applied via CSS custom property `--color-primary`)
- **Organization name** — shown in top-right client selector and in reports

CSS variable approach:
```css
:root {
  --color-primary:       #6366F1;
  --color-primary-hover: #4F46E5;
  --color-primary-light: #EEF2FF;
  --color-primary-text:  #4338CA;
}
```

All indigo references in components use these variables. Swapping the client theme is one variable update, no component changes.

### Theme constraints
- Primary color must pass 4.5:1 contrast on white (validated on save)
- Status colors (success/warning/error) never change — they are semantic, not branded
- Background and text never change — only primary accent

### Operator vs client roles
- Operators see all clients via a client switcher dropdown in top bar
- Clients see only their own data with their own branding applied
- Permission-based sections: Settings (branding tab) visible only to operators

---

## 10. White-Label and Scalability Guidance

### Architecture approach

The dashboard is designed for **Shape 2 deployment** — one n8n + Postgres + React stack per client, deployed via Docker Compose. Each stack is self-contained.

The white-label layer is applied at the React level:
- `client_config.json` loaded at app startup from API
- Config injected into React context at root
- All feature flags, branding, and automation visibility derived from context

### client_config.json — Full Schema

```json
{
  "client_id": "acme_corp",
  "client_name": "Acme Corp",
  "logo_url": "/assets/logos/acme_corp.svg",
  "primary_color": "#6366F1",
  "features_enabled": ["overview", "activity", "exceptions", "reports"],
  "automations": [
    {
      "id": "intake",
      "label": "Customer Intake",
      "description": "Qualifies and routes inbound leads",
      "icon": "user-check",
      "webhook": "/webhook/customer-intake",
      "db_table": "intake_log",
      "workflow_id": "customer_intake_v1",
      "nav_sections": ["activity", "exceptions", "reports"],
      "report_metrics": ["total_leads", "tier_breakdown", "avg_score"]
    },
    {
      "id": "appointments",
      "label": "Appointment Scheduling",
      "description": "Books, reschedules, and manages appointments",
      "icon": "calendar",
      "webhook": "/webhook/appointment",
      "db_table": "appointment_log",
      "workflow_id": "appointment_scheduling_v1",
      "nav_sections": ["calendar", "activity", "exceptions", "reports"],
      "report_metrics": ["total_appointments", "status_breakdown", "auto_confirm_rate"]
    }
  ]
}
```

**Key principle: automations is an array, never a hardcoded list.**
The UI maps over this array everywhere — sidebar, overview cards, activity feed filters, report sections, and the automations page. Adding or removing an automation requires only a config change. No React component changes.

### Automation Registry Pattern

Each automation entry in the config is the single source of truth for:

| Field | Used by |
|---|---|
| `id` | Route params, filter keys, DB query WHERE clauses |
| `label` | Display name in sidebar, cards, reports |
| `icon` | Lucide icon name rendered on automation card |
| `db_table` | API queries for run history and metrics |
| `workflow_id` | workflow_runs WHERE workflow_id = this |
| `nav_sections` | Which sidebar sections are relevant for this automation |
| `report_metrics` | Which metric cards to render in the Reports section |

### How reducibility works

A client with only `["intake"]` in their automations array:
- Sees 1 automation health card on Overview (not 3)
- Sees 1 tab on the Automations page
- Activity feed filters show only "Intake" — not Documents or Appointments
- Calendar section hidden (not in `features_enabled`)
- Reports page renders only intake metrics
- No broken empty sections, no "no data" placeholders for unused automations

### How expandability works

Adding a 4th automation (e.g. `billing`):
1. Create `billing_log` table in PostgreSQL
2. Add a UNION arm to `v_recent_activity`
3. Add the automation entry to `client_config.json`
4. The sidebar, overview, activity, and reports all pick it up automatically

No new React components needed for the standard case. Specialized UI (e.g. a billing-specific detail drawer) can be added as an optional extension without touching shared components.

### Feature visibility flags

`features_enabled` controls top-level nav sections independently of automations:

```json
"features_enabled": ["overview", "activity", "exceptions", "reports"]
```

Disabled sections are hidden from the sidebar entirely. No 403 page — simply not rendered. A client can have automations enabled but the Calendar section hidden if they don't use appointment scheduling as a client-facing feature.

### Multi-industry support

The dashboard is industry-neutral by design:
- All automation names, labels, and descriptions are strings from config — not hardcoded
- Status vocabulary is normalized in `v_recent_activity` — dashboard never reads raw DB status values directly
- Report metric cards are driven by `report_metrics[]` in each automation config
- A healthcare client sees "Patient Intake" and "Referral Processing" — same components, different config

### Scalability

As client count grows:
- Deploy new stacks via Docker Compose per client
- Apply a new `client_config.json` per deployment
- Each dashboard is fully isolated — no cross-client data risk

Future: a central operator console (not in scope for Phase 5) would aggregate across clients.

---

## 11. Phase 5 Architectural Constraints

These constraints are non-negotiable in the React build. They enforce the reducible/expandable design at the code level.

### Constraint 1 — No hardcoded automation lists
**Rule:** No React component may contain a hardcoded reference to "intake", "documents", or "appointments" as a static array or conditional branch.

**Wrong:**
```jsx
// NEVER DO THIS
const automations = ['intake', 'documents', 'appointments'];
```

**Right:**
```jsx
// Always derive from config
const { automations } = useClientConfig();
automations.map(automation => <AutomationCard key={automation.id} config={automation} />)
```

This applies to: Sidebar nav items, Overview health cards, Activity feed filters, Automations page tabs, Reports sections, Exception tags.

### Constraint 2 — ClientConfigContext is the single source of truth
**Rule:** All automation-specific logic (labels, icons, routes, db_table references, metric definitions) is read from `ClientConfigContext`. It is never duplicated in component files.

```jsx
// ClientConfigContext shape
{
  clientId: string,
  clientName: string,
  logoUrl: string,
  primaryColor: string,
  featuresEnabled: string[],
  automations: AutomationConfig[]
}
```

Components read from this context. They do not maintain their own copies of automation metadata.

### Constraint 3 — Feature sections are conditionally rendered at the router level
**Rule:** Sections not in `features_enabled` are removed from the router and sidebar. They do not render a 404 or empty state — they simply do not exist for that client.

```jsx
// Router applies feature gate
{config.featuresEnabled.includes('calendar') && (
  <Route path="/calendar" element={<CalendarPage />} />
)}
```

The sidebar `NavItem` component also reads `featuresEnabled` and skips hidden sections. No section is visible but empty.

### Constraint 4 — Automation-specific API calls use config values, not hardcoded strings
**Rule:** When querying workflow_runs or automation tables, use `automation.workflow_id` and `automation.db_table` from config. Never write `WHERE workflow_id = 'customer_intake_v1'` directly in a component.

```jsx
// Right — driven by config
const runs = await fetchRuns(automation.workflow_id);
```

### Constraint 5 — Report sections are generated from report_metrics[]
**Rule:** The Reports page maps over each automation's `report_metrics` array to decide which metric cards to render. No report section is hardcoded to a specific automation.

```jsx
automations.map(automation =>
  automation.report_metrics.map(metric =>
    <MetricCard key={metric} automationId={automation.id} metric={metric} />
  )
)
```

### Constraint 6 — Adding a new automation requires zero component changes
**Rule:** The test for whether these constraints are met: a new automation can be added by updating only `client_config.json` and the database (new table + view arm). If any React file needs editing to show the new automation, the constraint has been violated.

---

## 12. Phased Implementation Roadmap

### Phase 5a — Core Shell (Week 1)
Deliverables:
- React project setup (Vite + React + Tailwind + Recharts + React Router + Lucide React)
- Design token file: colors, spacing, radius, shadow, typography as Tailwind config
- `ClientConfigContext` — loads `client_config.json`, exposes automations array and feature flags
- Layout components: Sidebar (reads config for nav items), TopBar, PageWrapper
- Navigation wired: routes generated from `features_enabled`, not hardcoded
- AuthContext stub (no login flow yet — uses hardcoded client_id)

### Phase 5b — Overview + Automations (Week 1-2)
Deliverables:
- KPI strip: 4 cards, data from v_workflow_health and workflow_runs
- Automation health grid: maps over `config.automations` — renders N cards for N automations
- Automation detail pages: run history table, status, last run (driven by `automation.workflow_id`)
- Sparkline chart component (reusable, data-agnostic)
- Status badge component (reusable)
- Recent activity feed (10 items from v_recent_activity)

### Phase 5c — Activity + Exceptions (Week 2)
Deliverables:
- Full activity timeline: filters, grouping by date, virtual scroll
- Exceptions list: open / in review / resolved tabs
- Exception detail drawer component
- Notification panel

### Phase 5d — Documents + Tasks + Calendar (Week 2-3)
Deliverables:
- Documents grid + table toggle
- Document detail drawer with extracted fields
- Tasks board (three columns)
- Calendar month view with appointment events
- Appointment detail drawer

### Phase 5e — Reports (Week 3)
Deliverables:
- Summary metrics row (calculated from DB views)
- Per-automation charts: bar, donut, line
- Date range selector
- PDF export (react-pdf or window.print styled)

### Phase 5f — Polish and States (Week 3-4)
Deliverables:
- Skeleton screens on all data-loading sections
- Empty states on all sections
- Error state components
- Microinteraction polish (count-up, slide-in, animate-pulse)
- Responsive: tablet breakpoint (1024px) with collapsed sidebar
- Accessibility pass: focus rings, tab order, aria labels, skip link

### Phase 5g — Theming and Config (Week 4)
Deliverables:
- CSS variable theming
- client_config.json loading
- Logo injection
- Feature flag hiding/showing
- Settings page (notifications, appearance)

---

## 12. Premium Design — Non-Generic Rules

These are the specific decisions that separate a premium product from a templated dashboard.

**1. No widget soup.**
Maximum 4 KPI cards on any screen. No more than 2 chart types per section. Every element earns its space.

**2. One strong accent, used sparingly.**
Indigo appears on: active nav item, primary button, links, badge backgrounds (at 10%), CTA elements. Nowhere else. The rarity makes it meaningful.

**3. Typography does the heavy lifting.**
Hierarchy is achieved through size and weight, not color. The page does not need decorative color blocks to feel organized.

**4. Dates and numbers are formatted for humans.**
"3 minutes ago" not "2026-05-11T14:32:11Z". "$8,200/mo" not "8200". "94%" not "0.94". All data formatted at the component level.

**5. Empty states are never generic.**
Each section has a specific, accurate explanation of what will appear and when. No "No data found." No "Get started!" without context.

**6. The sidebar always knows where you are.**
Active state is never ambiguous. When in a document detail drawer, the Documents item remains active. Nested routes do not break sidebar state.

**7. Status is never text-only.**
Every status uses color + shape + text. Never just a word like "Active" with no visual indicator. Never just a colored dot with no label.

**8. Actions are where the user expects them.**
Primary action on a card is top-right. Primary action on a drawer is bottom-right sticky. Destructive action is always left of the cancel button, never rightmost.

**9. Confidence scores are visual.**
AI confidence is shown as a progress bar, not just a number. 0.92 is shown as a near-full emerald bar. 0.55 is a half-amber bar. Instantly scannable.

**10. The system explains itself.**
When an exception occurs, the copy says "Document could not be classified with high confidence — a human review has been requested." Not "Error: low_confidence." Plain language, always.

**11. Density is controlled.**
Tables use 44px row height minimum. Cards have 24px padding. Nothing is crammed. The dashboard breathes, which makes the data easier to read.

**12. Hover and focus states are never an afterthought.**
Every interactive element has a distinct hover AND focus state. Keyboard users can navigate the full dashboard without a mouse. Focus rings use indigo, visible against both white and slate backgrounds.

---

## Completion Checklist

- [x] Product vision defined — operational window, not admin tool
- [x] UI/UX strategy — progressive disclosure, status-first, calm exceptions
- [x] Visual design — tokens, palette, typography, elevation, radius defined
- [x] Information architecture — 9 sections, full URL structure
- [x] Screen layouts — wireframe-level spec for all 9 screens
- [x] Component guidance — sidebar, topbar, KPI, cards, drawers, badges, buttons, states
- [x] Interaction patterns — hover, scroll, drawer, polling, microinteractions
- [x] Empty / loading / error states — per section, no generic fallbacks
- [x] Branding + theming — CSS variables, client config, constraints
- [x] White-label + scalability — feature flags, Shape 2 alignment, multi-industry
- [x] Implementation roadmap — 7 phases, 4 weeks, ordered by dependency
- [x] Premium rules — 12 specific anti-generic decisions documented

---

*Phase 4 — Dashboard Design. Ready for Phase 5 — React Dashboard Build.*
