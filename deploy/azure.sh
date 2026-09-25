#!/usr/bin/env bash
# Deploys the HCI Implementation Hub to Azure App Service with Entra ID sign in and Teams single sign on.
# Run from the project folder in Azure Cloud Shell (shell.azure.com) or anywhere the Azure CLI is signed in.
#   bash deploy/azure.sh                      # defaults below
#   HUB_NAME=hci-hub RG=rg-hci-hub LOCATION=eastus2 bash deploy/azure.sh
# Re running is safe: every step creates or updates.
set -euo pipefail
: "${HUB_NAME:=hci-implementation-hub}"     # web app name, must be unique across Azure (becomes <name>.azurewebsites.net)
: "${RG:=rg-hci-hub}"
: "${LOCATION:=eastus}"
: "${SKU:=B1}"
: "${HCI_DOMAINS:=hci-tv.com,hcic.com}"
: "${CUSTOM_HOST:=}"                          # optional, e.g. hub.hci-tv.com (add the DNS CNAME first, see README)
TEAMS_CLIENT_1=1fec8e78-bce4-4aaf-ab1b-5451cc387264   # Teams desktop and mobile
TEAMS_CLIENT_2=5e3ce6c0-2b1f-4285-8d4b-75ee78787346   # Teams web

echo "== Azure account"
az account show --query "{subscription:name, tenant:tenantId}" -o table
TENANT=$(az account show --query tenantId -o tsv)
HOST=${CUSTOM_HOST:-$HUB_NAME.azurewebsites.net}

echo "== Resource group, plan and web app"
az group create -n "$RG" -l "$LOCATION" -o none
az appservice plan create -g "$RG" -n "$HUB_NAME-plan" --is-linux --sku "$SKU" -o none
az webapp create -g "$RG" -p "$HUB_NAME-plan" -n "$HUB_NAME" --runtime "NODE:20-lts" -o none
az webapp config set -g "$RG" -n "$HUB_NAME" --startup-file "npm start" --always-on true -o none 2>/dev/null || az webapp config set -g "$RG" -n "$HUB_NAME" --startup-file "npm start" -o none

echo "== Entra app registration (sign in for people, single sign on for Teams)"
APP_ID=$(az ad app list --display-name "HCI Implementation Hub" --query "[0].appId" -o tsv)
if [ -z "$APP_ID" ]; then
  APP_ID=$(az ad app create --display-name "HCI Implementation Hub" --sign-in-audience AzureADMyOrg \
    --web-redirect-uris "https://$HOST/.auth/login/aad/callback" --enable-id-token-issuance true --query appId -o tsv)
fi
SCOPE_ID=$(az ad app show --id "$APP_ID" --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" -o tsv)
[ -z "$SCOPE_ID" ] && SCOPE_ID=$(python3 -c "import uuid;print(uuid.uuid4())" 2>/dev/null || cat /proc/sys/kernel/random/uuid)
az ad app update --id "$APP_ID" --identifier-uris "api://$HOST/$APP_ID" \
  --web-redirect-uris "https://$HOST/.auth/login/aad/callback" --enable-id-token-issuance true -o none
APP_OBJ=$(az ad app show --id "$APP_ID" --query id -o tsv)
az rest --method PATCH --url "https://graph.microsoft.com/v1.0/applications/$APP_OBJ" --headers "Content-Type=application/json" --body "{\"api\":{\"requestedAccessTokenVersion\":2,\"oauth2PermissionScopes\":[{\"id\":\"$SCOPE_ID\",\"value\":\"access_as_user\",\"type\":\"User\",\"isEnabled\":true,\"adminConsentDisplayName\":\"Open the Hub as the signed in user\",\"adminConsentDescription\":\"Lets Microsoft Teams open the Implementation Hub as the signed in user.\",\"userConsentDisplayName\":\"Open the Hub as you\",\"userConsentDescription\":\"Lets Microsoft Teams open the Implementation Hub as you.\"}]}}"
sleep 5
az rest --method PATCH --url "https://graph.microsoft.com/v1.0/applications/$APP_OBJ" --headers "Content-Type=application/json" --body "{\"api\":{\"preAuthorizedApplications\":[{\"appId\":\"$TEAMS_CLIENT_1\",\"delegatedPermissionIds\":[\"$SCOPE_ID\"]},{\"appId\":\"$TEAMS_CLIENT_2\",\"delegatedPermissionIds\":[\"$SCOPE_ID\"]}]}}"
az ad sp create --id "$APP_ID" -o none 2>/dev/null || true
SECRET=$(az ad app credential reset --id "$APP_ID" --years 2 --display-name "app-service-auth" --query password -o tsv)

echo "== App settings"
az webapp config appsettings set -g "$RG" -n "$HUB_NAME" -o none --settings \
  MICROSOFT_PROVIDER_AUTHENTICATION_SECRET="$SECRET" REQUIRE_AUTH=1 HCI_DOMAINS="$HCI_DOMAINS" \
  HUB_DATA_DIR=/home/hub/data HUB_UPLOAD_DIR=/home/hub/uploads \
  WEBSITES_ENABLE_APP_SERVICE_STORAGE=true SCM_DO_BUILD_DURING_DEPLOYMENT=true WEBSITE_NODE_DEFAULT_VERSION=~20

echo "== App Service Authentication (Entra ID), pages public, API needs a signed in user"
az extension add --name authV2 --upgrade -o none 2>/dev/null || true
az webapp auth microsoft update -g "$RG" -n "$HUB_NAME" --client-id "$APP_ID" \
  --client-secret-setting-name MICROSOFT_PROVIDER_AUTHENTICATION_SECRET \
  --issuer "https://login.microsoftonline.com/$TENANT/v2.0" \
  --allowed-token-audiences "api://$HOST/$APP_ID" "$APP_ID" --yes -o none
az webapp auth update -g "$RG" -n "$HUB_NAME" --enabled true --unauthenticated-client-action AllowAnonymous --require-https true -o none

echo "== Deploy the code"
ZIP=$(mktemp -u).zip
zip -qr "$ZIP" . -x "node_modules/*" "uploads/*" "dist/*" ".git/*" "manifest/.appid"
az webapp deploy -g "$RG" -n "$HUB_NAME" --src-path "$ZIP" --type zip --clean true -o none
rm -f "$ZIP"

if [ -n "$CUSTOM_HOST" ]; then
  echo "== Custom domain $CUSTOM_HOST"
  az webapp config hostname add -g "$RG" --webapp-name "$HUB_NAME" --hostname "$CUSTOM_HOST" -o none
  az webapp config ssl create -g "$RG" -n "$HUB_NAME" --hostname "$CUSTOM_HOST" -o none && \
  THUMB=$(az webapp config ssl list -g "$RG" --query "[?contains(subjectName,'$CUSTOM_HOST')].thumbprint | [0]" -o tsv) && \
  az webapp config ssl bind -g "$RG" -n "$HUB_NAME" --certificate-thumbprint "$THUMB" --ssl-type SNI -o none
fi

echo "== Teams app package"
ENTRA_APP_ID="$APP_ID" node scripts/manifest.js "$HOST"

cat <<MSG

Done.
  Hub:            https://$HOST
  Entra app id:   $APP_ID
  Teams package:  dist/hci-implementation-hub-teams-app.zip

Next:
  1. Open https://$HOST and sign in with your HCI account.
  2. Grant admin consent once, so Teams can sign people in silently:
     https://login.microsoftonline.com/$TENANT/adminconsent?client_id=$APP_ID
  3. In Teams: Apps, Manage your apps, Upload a custom app, choose the package. Then add the tab to a channel.
MSG
