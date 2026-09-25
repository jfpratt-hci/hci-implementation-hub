#!/usr/bin/env bash
# Invites an outside person (customer, dealer, vendor) as a guest in HCI's Entra tenant so they can sign in to the Hub.
# Add them on the project's People page with the same email first; that record decides what they see.
#   bash deploy/invite.sh raymond@ballhealth.example "Raymond Broughton"
set -euo pipefail
EMAIL=${1:?email}; NAME=${2:-$1}
: "${HUB_NAME:=hcione-hub}"; : "${CUSTOM_HOST:=}"; : "${HUB_HOST:=}"
HOST=${HUB_HOST:-${CUSTOM_HOST:-$HUB_NAME.azurewebsites.net}}
az rest --method POST --url https://graph.microsoft.com/v1.0/invitations --headers "Content-Type=application/json" --body "$(cat <<JSON
{"invitedUserEmailAddress":"$EMAIL","invitedUserDisplayName":"$NAME","inviteRedirectUrl":"https://$HOST","sendInvitationMessage":true,
 "invitedUserMessageInfo":{"customizedMessageBody":"HCI has invited you to the Implementation Hub for your project. Accept to sign in with your work account, or with a one time code sent to this address."}}
JSON
)" --query "{invited:invitedUserEmailAddress,status:status,link:inviteRedeemUrl}" -o table
echo "Invited $EMAIL. They sign in at https://$HOST once they accept."
