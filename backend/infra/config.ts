/**
 * Single place for environment-level settings.
 * Region confirmed by the project owner: us-east-1 (N. Virginia).
 */
export interface EnvConfig {
  envName: string;
  region: string;
  /** Browser origins allowed by CORS. The first one is echoed in Lambda responses. */
  allowedOrigins: string[];
}

export const environments: Record<string, EnvConfig> = {
  dev: {
    envName: "dev",
    region: "us-east-1",
    // Local frontend dev server. Add the Amplify domain here once hosting exists.
    allowedOrigins: ["http://localhost:8002"],
  },
};
