# HCI Implementation Hub

The Hub as a web app on Azure and as a Microsoft Teams app. Same screens as the Claude version, with its own database, Entra ID sign in, per person access rules enforced on the server, and an audit trail the server writes.

## Deploying changes

Push to `main`. The GitHub Action in `.github/workflows/deploy.yml` copies the app to the Azure file share and restarts the Hub. The page itself is built from `hub/implementation-hub.html` with `python3 scripts/page.py`.

## First time deploy to Azure

Open Azure Cloud Shell (shell.azure.com, Bash), upload this folder's zip with the upload button, then:

```
unzip -q hci-implementation-hub-teams-app-source.zip && cd teams-app
bash deploy/azure.sh
```

Ten minutes. The script creates the resource group, a Linux App Service (B1, about $13 a month), the Entra app registration, App Service Authentication, deploys the code, and writes the Teams package to `dist/`. Re running it is safe. Options: `HUB_NAME=hci-hub CUSTOM_HOST=hub.hci-tv.com bash deploy/azure.sh` (for a custom host, first add a DNS CNAME from that name to `<HUB_NAME>.azurewebsites.net`).

When it finishes:

1. Open the Hub URL it prints and sign in with your HCI account.
2. Open the admin consent link it prints and accept once, so Teams can sign people in silently.
3. In Teams: Apps, Manage your apps, Upload a custom app, choose `dist/hci-implementation-hub-teams-app.zip`. Then + on a channel's tab bar, Implementation Hub, pick the project.

## Who gets in, and what they see

| Person | How they sign in | Role |
| --- | --- | --- |
| Anyone with an @hci-tv.com or @hcic.com account, or listed under Admin, HCI team | Their Microsoft 365 account; silent inside Teams | HCI, everything |
| A customer, dealer or vendor contact | Invited as a guest, then their own work account or a one time code by email | The party set on their People record, only the projects they are listed on |
| Anyone else who signs in | | Nothing |

To let an outside person in: add them on the project's People page with their email, then run `bash deploy/invite.sh their@email "Their Name"`. The server decides what each request may see and change, so the Preview as switch in the Claude version is exactly what they get.

## What is where

| Path | What it is |
| --- | --- |
| `server.js` | Node server: pages, JSON API, identity and access rules, audit trail, screenshot storage |
| `public/index.html`, `public/hub-data.js`, `public/config.html` | The Hub page, its data layer (API, Teams theme and single sign on), the tab configuration page |
| `data/*.json` | Seed data. On Azure the live data lives under `/home/hub` and is seeded from here on first start |
| `deploy/azure.sh`, `deploy/invite.sh` | Deploy and invite scripts |
| `manifest/`, `dist/` | Teams app manifest template and the built package |

Run locally without sign in: `npm install && npm start` (http://localhost:3000). The name box in the sidebar stands in for identity.

## Files and APKs

Every customer gets a SharePoint site with the same eight folders (contract, design, integration specs, site readiness, install and screenshots, training, APKs and releases, go live). Paste the site's Shared Documents link on the project and the Files tab links to each folder. Who can open the folders is set by SharePoint sharing.

## Later

Postgres instead of JSON files once the pilot is done (`data/` is one file per collection, so the move is mechanical), email and Teams notifications, HubSpot sync so a closed deal creates the project.
