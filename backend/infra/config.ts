/**
 * Single place for environment-level settings.
 * Region confirmed by the project owner: us-east-1 (N. Virginia).
 */
export interface EnvConfig {
  envName: string;
  region: string;
  /** Browser origins allowed by CORS. The first one is echoed in Lambda responses. */
  allowedOrigins: string[];
  /**
   * Email notifications via SES. DISABLED by default (TASK 05 decision 1).
   * To enable later: verify `fromAddress` in SES (and request production access), set both fields, deploy.
   * While disabled, the stack grants no SES permission and the notifier never creates an SES client.
   */
  email: { enabled: boolean; fromAddress: string };
}

export const environments: Record<string, EnvConfig> = {
  dev: {
    envName: "dev",
    region: "us-east-1",
    // Local frontend dev server. Add the Amplify domain here once hosting exists.
    allowedOrigins: ["http://localhost:8002"],
    email: { enabled: false, fromAddress: "" },
  },
};
