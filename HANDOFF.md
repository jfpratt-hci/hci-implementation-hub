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
