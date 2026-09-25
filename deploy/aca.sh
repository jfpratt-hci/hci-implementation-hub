#!/usr/bin/env bash
# Backup deploy: Azure Container Apps. Uses a different quota pool than App Service and needs no image build:
# a stock Node container reads the app from an Azure file share. Same app, same Entra sign in, same Teams package.
# Re running is safe and redeploys the latest code.
#   bash deploy/aca.sh
set -euo pipefail
: "${HUB_NAME:=hcione-hub}"
: "${RG:=rg-hci-hub-aca}"
: "${LOCATION:=eastus2}"
: "${HCI_DOMAINS:=hci-tv.com,hcic.com}"
TEAMS_CLIENT_1=1fec8e78-bce4-4aaf-ab1b-5451cc387264
TEAMS_CLIENT_2=5e3ce6c0-2b1f-4285-8d4b-75ee78787346
SA=$(echo "${HUB_NAME}data" | tr -cd 'a-z0-9' | cut -c1-22)
ENV_NAME="$HUB_NAME-env"

echo "== Azure account"
az account show --query "{subscription:name, tenant:tenantId}" -o table
TENANT=$(az account show --query tenantId -o tsv)

echo "== Register providers (first run can take a couple of minutes)"
for p in Microsoft.App Microsoft.OperationalInsights Microsoft.Storage; do az provider register -n $p -o none; done
for p in Microsoft.App Microsoft.OperationalInsights Microsoft.Storage; do
  until [ "$(az provider show -n $p --query registrationState -o tsv)" = "Registered" ]; do echo "   waiting for $p"; sleep 10; done
done
az extension add --name containerapp --upgrade -o none 2>/dev/null || true

echo "== Resource group and storage (database, screenshots, app code)"
az group create -n "$RG" -l "$LOCATION" -o none
az storage account show -g "$RG" -n "$SA" -o none 2>/dev/null || az storage account create -g "$RG" -n "$SA" -l "$LOCATION" --sku Standard_LRS --kind StorageV2 -o none
KEY=$(az storage account keys list -g "$RG" -n "$SA" --query "[0].value" -o tsv)
az storage share-rm create -g "$RG" --storage-account "$SA" -n hubdata --quota 5 -o none 2>/dev/null || true

echo "== Upload the app code"
SRC=$(mktemp -d)
cp -r server.js files.js package.json public data scripts manifest "$SRC"/
az storage directory create --account-name "$SA" --account-key "$KEY" --share-name hubdata --name app -o none
az storage file upload-batch --account-name "$SA" --account-key "$KEY" --destination hubdata --destination-path app --source "$SRC" -o none
rm -rf "$SRC"

echo "== Container Apps environment"
az containerapp env show -g "$RG" -n "$ENV_NAME" -o none 2>/dev/null || az containerapp env create -g "$RG" -n "$ENV_NAME" -l "$LOCATION" -o none
az containerapp env storage set -g "$RG" -n "$ENV_NAME" --storage-name hubdata \
  --azure-file-account-name "$SA" --azure-file-account-key "$KEY" --azure-file-share-name hubdata --access-mode ReadWrite -o none
ENV_ID=$(az containerapp env show -g "$RG" -n "$ENV_NAME" --query id -o tsv)

echo "== The app (one replica, since the database is files)"
SPEC=$(mktemp --suffix .json)
python3 - "$SPEC" "$LOCATION" "$ENV_ID" "$HCI_DOMAINS" <<'PY'
import json, sys, time
out, loc, env_id, domains = sys.argv[1:5]
start = "rm -rf /app && cp -r /data/app /app && cd /app && npm install --omit=dev --no-audit --no-fund && node server.js"
spec = {"location": loc, "properties": {
  "managedEnvironmentId": env_id,
  "configuration": {"ingress": {"external": True, "targetPort": 3000, "transport": "auto"}},
  "template": {
    "containers": [{"name": "hub", "image": "docker.io/library/node:20-alpine", "command": ["sh", "-c", start],
      "env": [{"name": "REQUIRE_AUTH", "value": "1"}, {"name": "HCI_DOMAINS", "value": domains},
              {"name": "HUB_DATA_DIR", "value": "/data/hub"}, {"name": "HUB_UPLOAD_DIR", "value": "/data/uploads"},
              {"name": "PORT", "value": "3000"}, {"name": "DEPLOY_STAMP", "value": str(int(time.time()))}],
      "resources": {"cpu": 0.25, "memory": "0.5Gi"},
      "volumeMounts": [{"volumeName": "hubdata", "mountPath": "/data"}]}],
    "scale": {"minReplicas": 1, "maxReplicas": 1},
    "volumes": [{"name": "hubdata", "storageName": "hubdata", "storageType": "AzureFile"}]}}}
json.dump(spec, open(out, "w"))
PY
# Sent straight to the Azure Resource Manager API; the CLI's --yaml path is unreliable across extension versions.
SUB=$(az account show --query id -o tsv)
APP_URL="https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.App/containerApps/$HUB_NAME?api-version=2024-03-01"
az rest --method PUT --url "$APP_URL" --headers "Content-Type=application/json" --body @"$SPEC" -o none
rm -f "$SPEC"
for i in $(seq 1 60); do
  STATE=$(az rest --method GET --url "$APP_URL" --query properties.provisioningState -o tsv 2>/dev/null || echo waiting)
  [ "$STATE" = "Succeeded" ] && break
  [ "$STATE" = "Failed" ] && { echo "The container app failed to provision. Check it in the portal under $RG."; exit 1; }
  echo "   app is $STATE"; sleep 10
done
HOST=$(az rest --method GET --url "$APP_URL" --query properties.configuration.ingress.fqdn -o tsv)

echo "== Entra app registration for $HOST"
APP_ID=$(az ad app list --display-name "HCI Implementation Hub" --query "[0].appId" -o tsv)
if [ -z "$APP_ID" ]; then
  APP_ID=$(az ad app create --display-name "HCI Implementation Hub" --sign-in-audience AzureADMyOrg --query appId -o tsv)
fi
az ad app update --id "$APP_ID" --identifier-uris "api://$HOST/$APP_ID" \
  --web-redirect-uris "https://$HOST/.auth/login/aad/callback" --enable-id-token-issuance true -o none
SCOPE_ID=$(az ad app show --id "$APP_ID" --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" -o tsv)
[ -z "$SCOPE_ID" ] && SCOPE_ID=$(cat /proc/sys/kernel/random/uuid)
APP_OBJ=$(az ad app show --id "$APP_ID" --query id -o tsv)
az rest --method PATCH --url "https://graph.microsoft.com/v1.0/applications/$APP_OBJ" --headers "Content-Type=application/json" --body "{\"api\":{\"requestedAccessTokenVersion\":2,\"oauth2PermissionScopes\":[{\"id\":\"$SCOPE_ID\",\"value\":\"access_as_user\",\"type\":\"User\",\"isEnabled\":true,\"adminConsentDisplayName\":\"Open the Hub as the signed in user\",\"adminConsentDescription\":\"Lets Microsoft Teams open the Implementation Hub as the signed in user.\",\"userConsentDisplayName\":\"Open the Hub as you\",\"userConsentDescription\":\"Lets Microsoft Teams open the Implementation Hub as you.\"}]}}"
# Graph only accepts preauthorization for a scope that already exists, so this is a second call.
sleep 5
az rest --method PATCH --url "https://graph.microsoft.com/v1.0/applications/$APP_OBJ" --headers "Content-Type=application/json" --body "{\"api\":{\"preAuthorizedApplications\":[{\"appId\":\"$TEAMS_CLIENT_1\",\"delegatedPermissionIds\":[\"$SCOPE_ID\"]},{\"appId\":\"$TEAMS_CLIENT_2\",\"delegatedPermissionIds\":[\"$SCOPE_ID\"]}]}}"
az ad sp create --id "$APP_ID" -o none 2>/dev/null || true
SECRET=$(az ad app credential reset --id "$APP_ID" --years 2 --display-name "container-apps-auth" --query password -o tsv)

echo "== Sign in (Entra ID): pages public, API needs a signed in user"
az containerapp secret set -g "$RG" -n "$HUB_NAME" --secrets microsoft-provider-authentication-secret="$SECRET" -o none
az containerapp auth microsoft update -g "$RG" -n "$HUB_NAME" --client-id "$APP_ID" \
  --client-secret-name microsoft-provider-authentication-secret \
  --issuer "https://login.microsoftonline.com/$TENANT/v2.0" \
  --allowed-token-audiences "api://$HOST/$APP_ID,$APP_ID" --yes -o none
az containerapp auth update -g "$RG" -n "$HUB_NAME" --enabled true --unauthenticated-client-action AllowAnonymous -o none

echo "== SharePoint documents: the Hub reads and writes customer libraries as its own app"
# Microsoft Graph application permission Sites.ReadWrite.All, then admin consent (needs a Microsoft 365 admin).
az ad app permission add --id "$APP_ID" --api 00000003-0000-0000-c000-000000000000 --api-permissions 9492366f-7969-46a4-8d15-ed1a20078fff=Role -o none 2>/dev/null || true
az ad app permission admin-consent --id "$APP_ID" -o none || echo "   Admin consent failed; run: az ad app permission admin-consent --id $APP_ID"
az containerapp update -g "$RG" -n "$HUB_NAME" --set-env-vars GRAPH_TENANT_ID="$TENANT" GRAPH_CLIENT_ID="$APP_ID" GRAPH_CLIENT_SECRET=secretref:microsoft-provider-authentication-secret -o none
REV=$(az containerapp revision list -g "$RG" -n "$HUB_NAME" --query "[?properties.active].name | [0]" -o tsv)
[ -n "$REV" ] && az containerapp revision restart -g "$RG" -n "$HUB_NAME" --revision "$REV" -o none

echo "== Teams app package"
ENTRA_APP_ID="$APP_ID" node scripts/manifest.js "$HOST"

cat <<MSG

Done.
  Hub:            https://$HOST
  Entra app id:   $APP_ID
  Teams package:  dist/hci-implementation-hub-teams-app.zip

Next:
  1. Give it two minutes to start, then open https://$HOST and sign in with your HCI account.
  2. Grant admin consent once: https://login.microsoftonline.com/$TENANT/adminconsent?client_id=$APP_ID
  3. In Teams: Apps, Manage your apps, Upload a custom app, choose the package.
  To invite someone later: HUB_HOST=$HOST bash deploy/invite.sh their@email "Their Name"
MSG
