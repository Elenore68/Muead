# Deploying Mue'ad to AWS (dev)

Everything here uses the profile `signin` and region `us-east-1` (`backend/infra/config.ts`). The AWS account comes from the
credentials of whoever deploys; it is never written in the code.

## 0. Before the first deploy
- Sign in: `aws login --profile signin` (opens the browser). Sessions expire; repeat when you see "session has expired".
- Check the account is the right one: `AWS_PROFILE=signin aws sts get-caller-identity`.
- Local checks pass: in `backend/` run `npx tsc --noEmit`, `npm test`, `npx cdk synth --quiet`.

## 1. Deploy (from `backend/`)
```
export AWS_PROFILE=signin AWS_REGION=us-east-1 CDK_DISABLE_VERSION_CHECK=1
npx cdk bootstrap            # once per account and region
npx cdk deploy --require-approval never
```
The deploy prints `ApiUrl`, `UserPoolId`, `UserPoolClientId`, `Region`, `TableName`, `FilesBucketName`.

## 2. Publish the frontend (AWS Amplify Hosting)
The stack creates an Amplify app (`muead-dev-web`, branch `main`) with no Git connection. Publish the current code with:
```
AWS_PROFILE=signin frontend/scripts/deploy-amplify.sh
```
It reads the stack outputs, builds the frontend with them, uploads the build and waits until it is live at the `WebUrl` output
(dev: https://main.d7t6x10y7twg1.amplifyapp.com). Run it again after every frontend change. Deploy the backend first when both changed.
CORS allows the hosted address and `http://localhost:8002`.

## 2b. Run the frontend locally against the same backend
Create `frontend/.env.local` (git-ignored) from `frontend/.env.example` with `VITE_API_BASE_URL` (the `ApiUrl`, with the `/v1/` stage),
`VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_CLIENT_ID`, then `npm run dev` in `frontend/` (http://localhost:8002).
Local errors returned by API Gateway itself (expired token 401, throttling, 5xx) carry the hosted origin only, so on localhost they show as a network error.

## 3. Create test users (there is no self sign-up)
For each person (replace the values; pick a strong temporary password and share it privately, never in Git). **Managers** are the people in the `ApprovalEligible` group: every submitted request goes to all of them automatically (except its owner), after they have signed in once.
```
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username <email> \
  --user-attributes Name=email,Value=<email> Name=email_verified,Value=true Name=name,Value="<Full name>" \
  --temporary-password '<temporary password>' --message-action SUPPRESS
aws cognito-idp admin-add-user-to-group --user-pool-id <UserPoolId> --username <email> --group-name ApprovalEligible   # approvers
aws cognito-idp admin-add-user-to-group --user-pool-id <UserPoolId> --username <email> --group-name PlatformAdmin      # admins
```
The first sign-in asks for a new password. People appear in the directory after their first sign-in.

## 4. Smoke test with two users (owner + approver)
1. Owner: create a request (all SOW fields) and submit it. It goes to the managers automatically; the approver must have signed in once and must not be the owner.
2. Approver: approve. Owner: Mark as scheduled, Start readiness, tick every checklist item, Start maintenance.
3. Add a note and an issue (Activity), Start validation, record the four results, complete with a closing summary.
4. Open the Report tab; check the bell notifications on both accounts and the Schedule page.

## 5. Things that stay off until the owner decides
Email (SES) is disabled in `config.ts`. AI summaries (Bedrock) are **enabled** in `config.ts` with `amazon.nova-lite-v1:0` (on-demand in us-east-1; the stack grants `bedrock:InvokeModel` on that model only). In the dev stack this was first switched on directly on the `muead-dev-summary` Lambda (environment variables plus an inline `BedrockNovaLite` role policy); the next `cdk deploy` makes the stack own this setting. Alarms, a dead-letter queue and a custom domain are not built.

## Cost and cleanup
Cognito, DynamoDB (on demand), Lambda and API Gateway cost very little at test volume. The table, bucket, user pool and KMS key are
`RETAIN`: `cdk destroy` leaves them behind (and the KMS key keeps costing), so delete them by hand if the environment is abandoned.
