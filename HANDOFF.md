# HCI Implementation Hub: handoff for Claude sessions

Read this first. It is what earlier sessions decided, so a new session can continue without the old conversation.

## What it is
HCI's own implementation management app (replaces the idea of buying Rocketlane or GUIDEcx). Runs on Azure Container Apps, signs people in with Microsoft Entra ID, and installs as a Microsoft Teams app so each customer channel gets a tab for its project.

- Live: https://hcione-hub.salmonmeadow-015ff141.eastus2.azurecontainerapps.io
- Azure: resource group `rg-hci-hub-aca`, container app `hcione-hub`, storage `hcionehubdata` (file share `hubdata`: `app/` is the code, `hub/` the data, `uploads/` screenshots and design prototypes)
- Entra app: `2624ce55-7cec-45d4-8f26-1b65600a8ede` (sign in, Teams single sign on, SharePoint through Microsoft Graph). Tenant `e55dab1c-8b8f-4c0b-bb05-f0fb52f04e62`
- Deploy: push to `main`. `.github/workflows/deploy.yml` copies the app to the file share and restarts the container (about two minutes)
- Teams package: `node scripts/manifest.js <host>` (manifest 1.25, `supportsChannelFeatures: tier1` for shared and private channels). Bump `version` in `manifest/manifest.template.json` on every change

## How the code is laid out
- `hub/implementation-hub.html`: the whole page (views, forms, styles). Build `public/index.html` from it with `python3 scripts/page.py` and commit both
- `server.js`: JSON API, identity and role rules, audit trail, design prototype files
- `files.js`: SharePoint documents per project through Microsoft Graph
- `helpdesk.js`: Help Desk tickets, the Twilio text webhook at /hooks/sms and on call paging (add on to 24x7 Enterprise Support)
- `public/hub-data.js`: data layer the page uses (API, Teams sign in, documents)

## Decisions John made (keep them)
- Navigation is a bar across the top, under the Teams channel tabs. No left sidebar. Tabs: Overview, Plan, Decisions, Files, Designs, System, Integrations, Team. System holds Configuration, Installed base, App changelog. Integrations holds Access and network. Team holds People, Feed, History
- Pages fit the window without scrolling wherever possible. Long lists scroll inside their card, not the page
- Inside a Teams channel the tab shows one project with no way back to the portfolio. The personal tab is the portfolio. Admin sits behind the gear
- Documents: one flat SharePoint library per customer, no folders. Names are built by the Hub: `##_CODE_CUSTOMER_Description_vN_YYYYMMDD.ext` with 01 CON, 02 DES, 03 INT, 04 NET, 05 INS, 06 TRN, 07 APK, 08 GOL. Documents open inside the Hub, no popout. Dealers do not see 01 CON; partners see only 03 INT
- Designs tab: working HTML prototypes per app, versioned, statuses Draft, Ready for review, Approved by customer. Served sandboxed from `/_design/<id>`
- Never store passwords, keys or MFA seeds in the Hub; record where they are kept
- Writing style for anything John reads: no hyphens, plain words, one page

## Open items
- SharePoint: admin consent for the Graph `Sites.ReadWrite.All` application permission, and the container env vars `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET=secretref:microsoft-provider-authentication-secret`. Until both are done the Files tab says SharePoint is not connected
- Ball Health apps: door sign, whiteboard, unit status board, rounding app. Prototypes to add in Designs
- Later: email and Teams notifications, HubSpot deal to project sync, Postgres instead of JSON files, custom domain hub.hci-tv.com, per site SharePoint grants


## Daily dashboard and board (Nov 3 2026)

One task list. The Hub `tasks` collection is the only place tasks live; the Plan tab, the Board tab and the front Dashboard all read and write it.

- Dashboard (default front tab): open tasks per HCI person, plus a "Stuck, waiting on third parties" panel grouped by who we are waiting on. Click a task to edit it.
- Board tab: lanes per HCI person plus a stuck lane, project chips, comments, edit window, two click delete.
- Plan tab: tasks have status Open, Stuck waiting on someone else, or Done. A stuck task can name a dealer, vendor or customer person on that project (waitingOnId) or a typed name (waitingOnName). Tasks also carry a Project select.
- Fields added to tasks: waitingOnId, waitingOnName, waitingSince, hospital, source, sourceDate, createdAt, doneAt.
- Inbox sync: server `daily.js` pulls new cards every 3 minutes from the Supabase tables `daily_board_tasks` and `daily_board_meta` (written by the 9:15 AM weekday scheduled task) and creates Hub tasks once per card id (tracked in `dailyMeta.imported`). Hospital names that match a Hub project are filed on that project. Cards in the waiting lane become stuck tasks owned by John Pratt. After import the Hub copy is the only one that counts. Env: DAILY_SUPABASE_URL, DAILY_SUPABASE_KEY (public anon key is the default), DAILY_FIRST_PULL_MS for tests.
- Client: `public/daily.js` exposes `HUB_DAILY.mount(el, "dash"|"board", ctx)`; ctx is built by `dailyCtx()` in the page.
- Customers (added Nov 3 2026): customer, then projects, then tasks. New `customers` collection (HCI only); projects carry `customerId`; tasks carry `projectId` and `customerId` (a task can sit on a customer before a project exists). On start, `daily.js` migrate() creates one customer per existing project and backfills tasks. The Customers tab (key portfolio) groups project cards under each customer. Imported Daily Update cards create a customer when the hospital is new.
- Project screens (Nov 3 2026): tabs are Overview, Plan, Files, Help Desk. Decisions, Designs, System, Integrations and Team tabs and the Decisions waiting portfolio tab are removed (data kept). Overview shows work by HCI person, project record, size and purchased hardware (components), team, small integrations list and links. Remote access and network (view access) and History (view audit) are reached by buttons in the Links card. Device by device configuration and the app changelog are gone (Board Remote and GitHub). GitHub repository link lives on the customer (`githubUrl`), HCI adds it by hand. Any HCI user can edit and create projects.
- Deploy: `daily.js` must stay in the copy list in .github/workflows/deploy.yml.

- Outlook add in (Nov 4 2026): `public/outlook/pane.html` is a read pane task pane (HCI staff only). It signs in with Office SSO (`Office.auth.getAccessToken`) and sends the bearer token to the existing Hub API, which Easy Auth already accepts. It matches the sender to a project through people emails, lists open tasks and tickets, adds a task (with the email attached as .eml via `/api/taskfile`) or opens a Help Desk ticket (`/api/helpdesk/:pid/tickets`, MRN and DOB stripped). Manifest: `node scripts/outlook-manifest.js <host>` writes `dist/hci-one-outlook-addin.xml` (id kept in `manifest/.outlookid`). One time Entra step: `bash deploy/outlook-entra.sh <app id>` pre authorizes the Office clients. Admin deploys the XML in Microsoft 365 admin center, Integrated apps, Upload custom apps. If the host changes, regenerate the XML.

- Nov 4 2026 (later): tasks have `startDate`. Board cards show customer, project link, then Start and Due chips (blank when not set). `fmtDay` in public/daily.js parses date only strings as local time (it showed due dates a day early in US time zones). One overview per customer: scope `customer` (`S.cid`, `VIEW.custOverview`) with Work, Where it stands (SharePoint, notes, Projects list with Plan/Files/Edit and links, Team, Integrations) and Size and hardware summed across the customer's projects. For HCI staff (not channel tabs, not role previews) a project has tabs Plan, Files, Help Desk only; `go("project","overview",id)` redirects to the customer overview. The Customers screen links the customer name to its overview and each project row to its Plan. Customers, dealers and Teams channel tabs still see the per project Overview.

## Plan tab (calendar scheduling)
- `public/plan.html` is the Plan tab (an iframe in the Hub). It reads and writes the same `tasks` collection as the Board. A task gets `plan: {day, start}` (day, optional minute of day) or `plan: {week}` (sometime that week), plus `planDur` (minutes). Done tasks without a plan show on the day they were completed.
- `calendar.js` serves `/api/calendar?start=&end=` (staff only): each team member's Outlook busy time through Graph, cached 5 minutes. Needs the Graph application permission `Calendars.Read` with admin consent on the same Entra app as the Files tab. Team members need an `email` on their team record (the Plan tab has an Add addresses button). Optional `PLAN_TIMEZONE` (Windows zone name, default Eastern Standard Time).
- Optional lock down: an Exchange application access policy can limit the app to the Hub team mailboxes.
