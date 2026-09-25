#!/usr/bin/env bash
# One time: lets GitHub Actions deploy the Hub to Azure without any stored password (OpenID Connect).
#   bash deploy/github-setup.sh <github-owner>/<repo>
# Prints the client id to put in .github/workflows/deploy.yml (Claude does that for you).
set -euo pipefail
REPO=${1:?give the repo as owner/name}
: "${RG:=rg-hci-hub-aca}"
SUB=$(az account show --query id -o tsv); TENANT=$(az account show --query tenantId -o tsv)
NAME="HCI Hub GitHub deploy"
APP_ID=$(az ad app list --display-name "$NAME" --query "[0].appId" -o tsv)
[ -z "$APP_ID" ] && APP_ID=$(az ad app create --display-name "$NAME" --query appId -o tsv)
az ad sp show --id "$APP_ID" -o none 2>/dev/null || az ad sp create --id "$APP_ID" -o none
sleep 15
# Only this resource group, nothing else in the subscription.
az role assignment create --assignee "$APP_ID" --role Contributor --scope "/subscriptions/$SUB/resourceGroups/$RG" -o none 2>/dev/null || true
az ad app federated-credential create --id "$APP_ID" --parameters "{\"name\":\"github-main\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"repo:$REPO:ref:refs/heads/main\",\"audiences\":[\"api://AzureADTokenExchange\"]}" -o none 2>/dev/null || echo "   (federated credential already there)"
cat <<MSG

Done. Paste this line back to Claude:
  GITHUB DEPLOY  client=$APP_ID  tenant=$TENANT  subscription=$SUB  repo=$REPO
MSG
