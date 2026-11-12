import * as cdk from "aws-cdk-lib";
import { environments } from "../config";
import { MueadStack } from "../lib/muead-stack";

const app = new cdk.App();
const envName = (app.node.tryGetContext("env") as string | undefined) ?? "dev";
const cfg = environments[envName];
if (!cfg) throw new Error(`Unknown environment "${envName}". Known: ${Object.keys(environments).join(", ")}`);

// Account is taken from the caller's AWS credentials at deploy time (never hard-coded).
new MueadStack(app, `Muead-${cfg.envName}`, {
  cfg,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: cfg.region },
});
