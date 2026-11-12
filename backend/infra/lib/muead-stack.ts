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
import type { EnvConfig } from "../config";

export interface MueadStackProps extends cdk.StackProps {
  cfg: EnvConfig;
}

/** Cognito groups = platform roles (SOW section 2 and 5.2). */
const ROLE_GROUPS = ["MaintenanceOwner", "TechnicalParticipant", "Approver", "PlatformAdmin"];

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
    for (const g of ROLE_GROUPS) {
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

    // Least privilege per function.
    table.grantReadWriteData(fnMe);
    table.grantReadWriteData(fnRequests);
    table.grantReadWriteData(fnAttachments);
    table.grantReadData(fnDashboard);
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

    // ---------- Outputs (needed by the frontend configuration) ----------
    new cdk.CfnOutput(this, "ApiUrl", { value: api.url });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "Region", { value: this.region });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "FilesBucketName", { value: bucket.bucketName });
  }
}
