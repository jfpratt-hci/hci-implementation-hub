#!/usr/bin/env bash
# One time: let Outlook (desktop, web, new Outlook) sign HCI staff into the Hub add in.
# Adds the Office client apps as pre authorized clients of the Hub's Entra app, next to the Teams ones.
# Run in Azure Cloud Shell as someone who owns the app registration.  Usage: bash deploy/outlook-entra.sh <app id>
set -euo pipefail
APP_ID="${1:?Give the Hub Entra app (client) id}"
OBJ=$(az ad app show --id "$APP_ID" --query id -o tsv)
SCOPE=$(az ad app show --id "$APP_ID" --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" -o tsv)
[ -n "$SCOPE" ] || { echo "The app has no access_as_user scope. Set up the Teams app first."; exit 1; }
OFFICE="d3590ed6-52b3-4102-aeff-aad2292ab01c ea5a67f6-b6f3-4338-b240-c655ddc3cc8e 57fb890c-0dab-4253-a5e0-7188c88b2bb4 08e18876-6177-487e-b8b5-cf950c1e598c bc59ab01-8403-45c6-8796-ac3ef710b3e3 0ec893e0-5785-4de6-99da-4ed124e5296c 4765445b-32c6-49b0-83e6-1d93765276ca 93d53678-613d-4013-afc1-62e9e444a0a5"
EXISTING=$(az ad app show --id "$APP_ID" --query "api.preAuthorizedApplications" -o json)
BODY=$(EXISTING="$EXISTING" SCOPE="$SCOPE" OFFICE="$OFFICE" node -e '
const ex=JSON.parse(process.env.EXISTING||"[]")||[];const have=new Set(ex.map(x=>x.appId));
for(const id of process.env.OFFICE.split(" ")) if(!have.has(id)) ex.push({appId:id,delegatedPermissionIds:[process.env.SCOPE]});
console.log(JSON.stringify({api:{preAuthorizedApplications:ex}}))')
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$OBJ" --headers "Content-Type=application/json" --body "$BODY"
echo "Done. Outlook can now sign people in to the HCI ONE add in."
