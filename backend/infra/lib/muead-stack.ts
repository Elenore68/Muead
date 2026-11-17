import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as eventsources from "aws-cdk-lib/aws-lambda-event-sources";
import type { EnvConfig } from "../config";

export interface MueadStackProps extends cdk.StackProps {
  cfg: EnvConfig;
}

/**
 * Organization-level Cognito groups only.
 *  - PlatformAdmin:    platform administration (unchanged).
 *  - ApprovalEligible: may be ASSIGNED as an approver; grants no approval authority by itself.
 * Activity roles (owner / participant / approver) are per request in DynamoDB, not Cognito groups.
 * The former MaintenanceOwner / TechnicalParticipant / Approver groups were removed before any deployment.
 */
const ORG_GROUPS = ["PlatformAdmin", "ApprovalEligible"];

interface RouteDef {
  method: string;
  /** API path relative to /v1, e.g. "requests/{requestId}" */
  path: string;
}

export class MueadStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MueadStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    const prefix = `muead-${cfg.envName}`;

    // ---------- Encryption (SOW 5.8 KMS) ----------
    const key = new kms.Key(this, "DataKey", {
      alias: `alias/${prefix}-data`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ---------- DynamoDB (SOW 5.4), design: docs/backend/database-design.md ----------
    const table = new dynamodb.Table(this, "MainTable", {
      tableName: `${prefix}-main`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // TASK 05: audit inserts feed the notifier; notifications expire after 180 days via `ttl`.
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      timeToLiveAttribute: "ttl",
    });
    for (const n of [1, 2, 3]) {
      table.addGlobalSecondaryIndex({
        indexName: `GSI${n}`,
        partitionKey: { name: `GSI${n}PK`, type: dynamodb.AttributeType.STRING },
        sortKey: { name: `GSI${n}SK`, type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      });
    }

    // ---------- S3: attachments and reports (SOW 5.4) ----------
    const bucket = new s3.Bucket(this, "FilesBucket", {
      bucketName: undefined, // generated: avoids global-name collisions
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      bucketKeyEnabled: true,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          // Browser uploads/downloads with pre-signed URLs.
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: cfg.allowedOrigins,
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
    });

    // ---------- Cognito (SOW 5.2) ----------
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${prefix}-users`,
      // ASSUMPTION (open question 4): users are created by an administrator, no self sign-up.
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true }, fullname: { required: false, mutable: true } },
      passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: true },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    for (const g of ORG_GROUPS) {
      new cognito.CfnUserPoolGroup(this, `Group${g}`, { userPoolId: userPool.userPoolId, groupName: g });
    }
    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: `${prefix}-web`,
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ---------- Lambda functions (SOW 5.3) ----------
    const commonEnv = {
      TABLE_NAME: table.tableName,
      BUCKET_NAME: bucket.bucketName,
      ALLOWED_ORIGIN: cfg.allowedOrigins[0],
      NODE_OPTIONS: "--enable-source-maps",
    };
    const mkFn = (name: string, entry: string): nodejs.NodejsFunction =>
      new nodejs.NodejsFunction(this, `Fn${name}`, {
        functionName: `${prefix}-${name.toLowerCase()}`,
        entry: path.join(__dirname, "..", "..", "src", "handlers", entry),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: cdk.Duration.seconds(15),
        environment: commonEnv,
        logGroup: new logs.LogGroup(this, `Logs${name}`, {
          logGroupName: `/aws/lambda/${prefix}-${name.toLowerCase()}`,
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        bundling: { minify: true, sourceMap: true, target: "node22" },
      });

    const fnMe = mkFn("Me", "me.ts");
    const fnRequests = mkFn("Requests", "requests.ts");
    const fnAttachments = mkFn("Attachments", "attachments.ts");
    const fnDashboard = mkFn("Dashboard", "dashboard.ts");
    const fnReference = mkFn("Reference", "reference.ts");
    const fnUsers = mkFn("Users", "users.ts");
    const fnMembers = mkFn("Members", "members.ts");
    const fnApprovals = mkFn("Approvals", "approvals.ts");
    const fnTasks = mkFn("Tasks", "tasks.ts");
    const fnActivity = mkFn("Activity", "activity.ts");
    const fnReadiness = mkFn("Readiness", "readiness.ts");
    const fnNotifications = mkFn("Notifications", "notifications.ts");
    const fnNotifier = mkFn("Notifier", "notifier.ts");

    // ---------- Notifications (TASK 05, SOW 4.3 / 4.4 / 5.5) ----------
    if (cfg.email.enabled && !cfg.email.fromAddress.includes("@")) {
      throw new Error("config.email.enabled requires config.email.fromAddress (an SES-verified sender)");
    }
    fnNotifier.addEnvironment("EMAIL_ENABLED", String(cfg.email.enabled));
    fnNotifier.addEnvironment("EMAIL_FROM", cfg.email.enabled ? cfg.email.fromAddress : "");
    fnNotifier.addEnvironment("APP_URL", cfg.allowedOrigins[0]);
    fnNotifier.addEventSource(
      new eventsources.DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 25,
        retryAttempts: 5,
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
        // Only new audit entries; every other table write is ignored before the function is invoked.
        filters: [
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual("INSERT"),
            dynamodb: { NewImage: { entityType: { S: lambda.FilterRule.isEqual("AUDIT") } } },
          }),
        ],
      }),
    );
    if (cfg.email.enabled) {
      // Least privilege: send only as the configured sender identity. Not granted while email is disabled.
      fnNotifier.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["ses:SendEmail"],
          resources: [`arn:aws:ses:${this.region}:${this.account}:identity/${cfg.email.fromAddress}`],
        }),
      );
    }

    // Least privilege per function.
    table.grantReadWriteData(fnMe);
    table.grantReadWriteData(fnRequests);
    table.grantReadWriteData(fnAttachments);
    table.grantReadData(fnDashboard);
    table.grantReadData(fnUsers);
    table.grantReadWriteData(fnMembers);
    table.grantReadWriteData(fnApprovals);
    table.grantReadWriteData(fnTasks);
    table.grantReadWriteData(fnActivity);
    table.grantReadWriteData(fnReadiness);
    table.grantReadWriteData(fnNotifications); // own notification items only (enforced by key in the handler)
    table.grantReadWriteData(fnNotifier); // reads request/members/profiles, writes notification items
    bucket.grantReadWrite(fnAttachments); // includes KMS use via the bucket key policy grant
    key.grantEncryptDecrypt(fnAttachments);

    // ---------- API Gateway (SOW 5.3) ----------
    const api = new apigw.RestApi(this, "Api", {
      restApiName: `${prefix}-api`,
      deployOptions: {
        stageName: "v1",
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: cfg.allowedOrigins,
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
        maxAge: cdk.Duration.hours(1),
      },
    });
    // CORS headers on gateway-generated errors (401/403/429/5xx) so the browser can read them.
    for (const [id, type] of [
      ["Gw4xx", apigw.ResponseType.DEFAULT_4XX],
      ["Gw5xx", apigw.ResponseType.DEFAULT_5XX],
    ] as const) {
      api.addGatewayResponse(id, {
        type,
        responseHeaders: {
          "Access-Control-Allow-Origin": `'${cfg.allowedOrigins[0]}'`,
          "Access-Control-Allow-Headers": "'Authorization,Content-Type,Idempotency-Key'",
        },
      });
    }

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, "Authorizer", {
      cognitoUserPools: [userPool],
      identitySource: "method.request.header.Authorization",
    });

    const resourceCache = new Map<string, apigw.IResource>();
    const resourceFor = (p: string): apigw.IResource => {
      let cur: apigw.IResource = api.root;
      let acc = "";
      for (const part of p.split("/").filter(Boolean)) {
        acc += `/${part}`;
        let r = resourceCache.get(acc);
        if (!r) {
          r = cur.addResource(part);
          resourceCache.set(acc, r);
        }
        cur = r;
      }
      return cur;
    };
    const wire = (fn: lambda.IFunction, routes: RouteDef[]) => {
      const integration = new apigw.LambdaIntegration(fn, { proxy: true });
      for (const r of routes) {
        resourceFor(r.path).addMethod(r.method, integration, {
          authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
        });
      }
    };

    // Routes follow docs/backend/api-specification.md. Keep in sync with the `routes` maps in src/handlers/*.
    wire(fnMe, [
      { method: "GET", path: "me" },
      { method: "PATCH", path: "me" },
    ]);
    wire(fnRequests, [
      { method: "GET", path: "requests" },
      { method: "POST", path: "requests" },
      { method: "GET", path: "requests/counts" },
      { method: "GET", path: "requests/{requestId}" },
      { method: "PATCH", path: "requests/{requestId}" },
      { method: "POST", path: "requests/{requestId}/transition" },
      { method: "POST", path: "requests/{requestId}/cancel" },
    ]);
    wire(fnAttachments, [
      { method: "GET", path: "requests/{requestId}/attachments" },
      { method: "POST", path: "requests/{requestId}/attachments" },
      { method: "POST", path: "requests/{requestId}/attachments/{attachmentId}/confirm" },
      { method: "GET", path: "requests/{requestId}/attachments/{attachmentId}/download-url" },
      { method: "DELETE", path: "requests/{requestId}/attachments/{attachmentId}" },
    ]);
    wire(fnDashboard, [
      { method: "GET", path: "dashboard/summary" },
      { method: "GET", path: "dashboard/requests-over-time" },
      { method: "GET", path: "dashboard/upcoming" },
    ]);
    wire(fnReference, [{ method: "GET", path: "reference-data" }]);
    wire(fnUsers, [{ method: "GET", path: "users" }]);
    wire(fnMembers, [
      { method: "GET", path: "requests/{requestId}/members" },
      { method: "POST", path: "requests/{requestId}/members" },
      { method: "DELETE", path: "requests/{requestId}/members/{userId}" },
      { method: "PATCH", path: "requests/{requestId}/members/{userId}" },
      { method: "POST", path: "requests/{requestId}/participation" },
    ]);
    wire(fnReadiness, [
      { method: "GET", path: "requests/{requestId}/readiness" },
      { method: "POST", path: "requests/{requestId}/readiness" },
      { method: "PATCH", path: "requests/{requestId}/readiness/{itemId}" },
      { method: "DELETE", path: "requests/{requestId}/readiness/{itemId}" },
    ]);
    wire(fnActivity, [
      { method: "GET", path: "requests/{requestId}/activity" },
      { method: "POST", path: "requests/{requestId}/activity" },
      { method: "PATCH", path: "requests/{requestId}/activity/{entryId}" },
    ]);
    wire(fnTasks, [
      { method: "GET", path: "requests/{requestId}/tasks" },
      { method: "POST", path: "requests/{requestId}/tasks" },
      { method: "PATCH", path: "requests/{requestId}/tasks/{taskId}" },
      { method: "DELETE", path: "requests/{requestId}/tasks/{taskId}" },
    ]);
    wire(fnNotifications, [
      { method: "GET", path: "notifications" },
      { method: "GET", path: "notifications/unread-count" },
      { method: "POST", path: "notifications/read-all" },
      { method: "POST", path: "notifications/{notificationId}/read" },
    ]);
    wire(fnApprovals, [
      { method: "POST", path: "requests/{requestId}/submit" },
      { method: "POST", path: "requests/{requestId}/withdraw" },
      { method: "POST", path: "requests/{requestId}/approvals/decision" },
      { method: "GET", path: "requests/{requestId}/approvals" },
      { method: "GET", path: "approvals" },
      { method: "GET", path: "approvals/summary" },
    ]);

    // ---------- Outputs (needed by the frontend configuration) ----------
    new cdk.CfnOutput(this, "ApiUrl", { value: api.url });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "Region", { value: this.region });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "FilesBucketName", { value: bucket.bucketName });
  }
}
