#!/usr/bin/env bash
# Builds the frontend against the deployed stack and publishes it to AWS Amplify Hosting (manual deployment).
# Usage (from the repository root):  AWS_PROFILE=signin frontend/scripts/deploy-amplify.sh [stack-name]
# Needs: AWS CLI v2, Node 22, curl, zip. Reads every value from the CloudFormation outputs; nothing is hard-coded.
set -euo pipefail
STACK="${1:-Muead-dev}"
REGION="${AWS_REGION:-us-east-1}"
cd "$(dirname "$0")/.."

out() { aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
APP_ID="$(out WebAppId)"; WEB_URL="$(out WebUrl)"
API_URL="$(out ApiUrl)"; POOL_ID="$(out UserPoolId)"; CLIENT_ID="$(out UserPoolClientId)"
for v in APP_ID WEB_URL API_URL POOL_ID CLIENT_ID; do [ -n "${!v}" ] && [ "${!v}" != "None" ] || { echo "Missing stack output for $v. Deploy the backend first (cdk deploy)." >&2; exit 1; }; done

echo "Building for $API_URL"
# Public identifiers only (no secrets). They are compiled into the bundle.
VITE_API_BASE_URL="${API_URL%/}" VITE_COGNITO_USER_POOL_ID="$POOL_ID" VITE_COGNITO_CLIENT_ID="$CLIENT_ID" npm run build

ZIP="$(mktemp -d)/site.zip"
(cd dist && zip -qr "$ZIP" .)

echo "Uploading to Amplify app $APP_ID (branch main)"
read -r JOB_ID UPLOAD_URL < <(aws amplify create-deployment --region "$REGION" --app-id "$APP_ID" --branch-name main --query "[jobId, zipUploadUrl]" --output text)
curl -sf -X PUT -H "Content-Type: application/zip" --upload-file "$ZIP" "$UPLOAD_URL" >/dev/null
aws amplify start-deployment --region "$REGION" --app-id "$APP_ID" --branch-name main --job-id "$JOB_ID" >/dev/null

for _ in $(seq 1 60); do
  STATUS="$(aws amplify get-job --region "$REGION" --app-id "$APP_ID" --branch-name main --job-id "$JOB_ID" --query "job.summary.status" --output text)"
  case "$STATUS" in
    SUCCEED) echo "Live at $WEB_URL"; exit 0 ;;
    FAILED|CANCELLED) echo "Deployment $JOB_ID: $STATUS" >&2; exit 1 ;;
  esac
  sleep 5
done
echo "Deployment $JOB_ID is still running; check the Amplify console." >&2
exit 1
