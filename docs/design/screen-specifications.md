# Mue'ad Screen Specifications

Source: `docs/design/Muead-UI-Reference.pdf`. Tags: **[Confirmed]** visible, **[Approx.]** estimated, **[Assumption]** not shown in the reference.
The SOW (`Cloud-Maintenance-Planner-SOW.pdf`) was not available, so no functional requirements are cross-checked here.

## 1. Shared layout [Confirmed]

```
+-----------+--------------------------------------------------+
| Sidebar   | Top area: title/subtitle (or breadcrumb + title) |
| logo      |                         bell(red dot)  avatar ▾  |
| nav items +--------------------------------------------------+
| ---       | Page content (cards / table / form)              |
| Team list |                                                  |
| wave      |                                                  |
+-----------+--------------------------------------------------+
```

- Sidebar about 16% of width, gradient lilac, logo top, 7 nav items, Team list with presence dots, decorative wave at the bottom.
- Content area on gradient wash, content in rounded translucent cards.
- Active nav item: gradient pill, white text.
- Logged-in user shown as "Amal" with a purple avatar "A".

## 2. Dashboard (pages 4 and 5)

Two versions exist. Page 5 is a superset of page 4.

| Area | Content |
|---|---|
| Header | "Good morning, Amal 👋" (emoji is in the reference), subtitle "Here's what's happening in Mue'ad today." |
| KPI row (4 cards) | Total Requests 12 (purple doc icon), Pending Approvals 4 (orange hourglass), In Progress 5 (violet refresh), Completed 3 (green check). Icon tile + number + label; faint corner tint. Page 4 stacks icon above number; page 5 places the icon left. |
| Requests by Status | Donut, center "12 Requests", legend Pending 4, In Progress 5, Completed 3. |
| Upcoming Schedule | 3 items (System Update Nov 12 10:00 AM; Application Upgrade Nov 15 2:00 PM; Backup Review (p4) / Database Backup (p5) Nov 18 9:00 AM), chevrons, "View All". |
| Page 4 only | Recent Requests table (ID, Title, Requested by, Status) and AI Activity Summary card with "Generate Summary" gradient button and document illustration. |
| Page 5 only | Requests Over Time (area/line chart, Oct 25 - Nov 10) and Requests by Category (System 4, Application 3, Infrastructure 3, Other 2). |

Notes:
- Donut/legend color mismatch: in p4 and p5 the legend dots (Pending purple, In Progress pink, Completed orange) do not match the semantic status colors used elsewhere (Pending orange, Completed green). See section 8.
- Schedule markers: dots (p4) vs vertical bars (p5).
- Sidebar label: "Team Members" (p4) vs "Team" (p5).

## 3. Maintenance Requests (page 1 detailed, page 3 top-left compact)

**Header**: title "Maintenance Requests", subtitle "View, track, and manage all maintenance requests." CTA "+ New Request" top-right.
**Toolbar**: pill tabs All (12), Pending (4), In Progress (3), Completed (4), Rejected (1); search field "Search requests..."; filter icon button.
**Table columns (p1)**: Request ID, Title (with icon tile), Category, Requested by, Assigned to, Priority, Status, Created, row kebab. Sort chevrons on headers.
**Rows (p1)**: REQ-0142 ... REQ-0138, five rows. Footer "Showing 1-5 of 12 requests" and pagination 1 2 3.
**Compact version (p3)**: tabs All (12), Pending (4), In Progress (5), Completed (3); columns Request ID, Title, Requested by, Priority, Status, Created; IDs REQ-0012 ... REQ-0008.

Inconsistencies: tab counts differ (p1: In Progress 3, Completed 4, Rejected 1; p3: In Progress 5, Completed 3, no Rejected tab; dashboard says 5 / 3). Page 1 CTA is solid blue, page 3 is gradient. Nav label "Maintenance Requests" vs "Requests". Request IDs differ between p1 and p3 (sample data only).

## 4. Create Maintenance Request (page 3 top-right)

- Breadcrumb `Requests > New Request`; title "Create Maintenance Request"; subtitle "Submit a new request and provide the details."
- Form card (left): Title*, Description* (textarea), Category*, Priority*, Target Date* (row of 3), Attachments (Optional) dropzone, buttons Cancel and Submit Request.
- Guidelines card (right): illustration and four checked tips.
- Observation: the Attachments label shows "(Optional) *" which is contradictory. [Assumption] treat attachments as optional and drop the asterisk, to confirm.
- Nav highlight: "Requests".

## 5. Request Details (page 3 bottom-right)

- Breadcrumb `Requests > REQ-0011`; back arrow, title "REQ-0011 - App Enhancement", status pill (Pending) and kebab at the right.
- Tabs: Details (active), Activity, Approvals, Attachments. Only Details is drawn; the other three tab contents are **not designed**.
- Main card "Request Information": rows with icon tile + label + value: Title, Description, Category (Application), Priority (Medium pill), Target Date (Nov 15, 2026).
- Right column: Requested by (avatar Shahad), Status (Pending pill), Created on (Nov 9, 2026, 10:24 AM).
- Actions: solid green "Approve", outline red "Reject".
- Nav highlight shows "Approvals" for this screen, which is probably a mockup error (it should be Requests). See section 8.

## 6. Approvals (page 2 detailed, page 3 bottom-left compact)

**Header**: "Approvals", subtitle "Review and take action on maintenance requests." (p2) / "...on pending requests." (p3).
**KPI row (p2 only)**: Pending Approvals 4 (orange hourglass), Approved 8 (green check), Rejected 2 (red X).
**Tabs**: Pending (4), Approved (8), Rejected (2). Search and filter (p2).
**Table (p2)**: checkbox, Request ID, Title + description, Requested by, Category (icon chip), Priority, Requested on (date + time), Actions (Approve outline-blue, Reject outline-red). Bulk selection via checkboxes (a bulk action bar is not shown). Footer "Showing 1-4 of 4 requests", pagination.
**Table (p3)**: Request ID, Title, Requested by, Priority, Submitted on, Actions (Approve green outline, Reject red outline).
Inconsistencies: Approve color, "Requested on" vs "Submitted on", nav highlight "Schedule" on the p3 Approvals mock, KPI row only on p2, nav label "Requests" vs "Maintenance Requests".

## 7. Screens not shown in the reference [Assumption]

Schedule, Reports, Team, Settings, Login, Notifications panel, user menu, filter panel, row kebab menu, reject-reason dialog, empty states, error states, loading states, Activity/Approvals/Attachments tabs of the details page. These need design input; they must be built from the design system and not invented as a new look.

## 8. Observed inconsistencies to resolve

| # | Item | Variants | Proposed default [Assumption] |
|---|---|---|---|
| 1 | Primary CTA | Solid blue (p1), gradient (p3) | Brand gradient (matches Generate Summary and Submit) |
| 2 | In Progress color | Blue (p1), purple (p3/p4) | Blue, so that purple stays as brand color; confirm |
| 3 | Approve button | Blue outline, green outline, solid green | Green (semantic), outline in tables, solid on detail |
| 4 | Nav label | "Maintenance Requests" vs "Requests" | "Requests" (fits sidebar width) |
| 5 | Sidebar group title | "Team" vs "Team Members" | "Team" |
| 6 | Logo in sidebar | Latin only vs Latin + Arabic | Latin + Arabic per the logo sheet, confirm |
| 7 | Active nav on Approvals/Details (p3) | Wrong item highlighted | Highlight the item matching the section |
| 8 | Donut colors | Purple/pink/orange vs semantic status colors | Use semantic status colors in charts |
| 9 | Attachments label | "(Optional) *" | Optional, no asterisk |
| 10 | Status counts | Differ between screens | Sample data, ignore |

## 9. Layout consistency summary [Confirmed]
Consistent across screens: sidebar structure, top bar with bell and avatar, title + subtitle pattern, pill tabs, rounded translucent cards, hairline-bordered tables with pagination footer, initial avatars, pill chips, and outline icons. Spacing and radius appear uniform.
