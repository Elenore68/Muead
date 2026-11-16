/*
 * Email delivery (TASK 05). DISABLED BY DEFAULT.
 *
 * Enabled only when BOTH environment variables are set by the stack (infra/config.ts `email`):
 *   EMAIL_ENABLED=true  and  EMAIL_FROM=<an SES-verified sender>
 * When disabled, no SES client is created and no network call is made; notifications are stored as in-app only
 * with emailStatus = "DISABLED". Sender verification and SES production access are NOT configured by this code.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

export type EmailStatus = "DISABLED" | "SKIPPED_PREFERENCE" | "SKIPPED_NO_ADDRESS" | "SENT" | "FAILED";

export interface EmailConfig {
  enabled: boolean;
  from: string;
  appUrl: string;
}

export const emailConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): EmailConfig => {
  const from = (env.EMAIL_FROM ?? "").trim();
  return { enabled: env.EMAIL_ENABLED === "true" && from.length > 0, from, appUrl: (env.APP_URL ?? "").replace(/\/+$/, "") };
};

/** SES v2 sender. Loaded lazily so the disabled path never imports or constructs the SES client. */
export const sesSender = (from: string): EmailSender => {
  let client: import("@aws-sdk/client-sesv2").SESv2Client | undefined;
  return {
    async send(msg) {
      const ses = await import("@aws-sdk/client-sesv2");
      client ??= new ses.SESv2Client({});
      await client.send(
        new ses.SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [msg.to] },
          Content: { Simple: { Subject: { Data: msg.subject, Charset: "UTF-8" }, Body: { Text: { Data: msg.text, Charset: "UTF-8" } } } },
        }),
      );
    },
  };
};

/** Plain-text email for one notification. Contains no request content beyond what the notification shows. */
export const renderEmail = (n: { title: string; body: string; requestId: string | null }, appUrl: string): { subject: string; text: string } => {
  const link = n.requestId && appUrl ? `\n\nOpen in Mue'ad: ${appUrl}/requests/${encodeURIComponent(n.requestId)}` : "";
  return {
    subject: `Mue'ad: ${n.title}`.slice(0, 200),
    text: `${n.body}${link}\n\nYou can turn off email notifications in your Mue'ad settings.`,
  };
};

/**
 * Decides and (if allowed) sends. Never throws: delivery problems must not block in-app notifications.
 * Recipient preferences: notificationPrefs.email === false means "no email" (default is on, see GET /me).
 */
export const deliverEmail = async (
  cfg: EmailConfig,
  sender: EmailSender | undefined,
  recipient: { email?: string; notificationPrefs?: { email?: boolean } } | undefined,
  n: { title: string; body: string; requestId: string | null },
): Promise<EmailStatus> => {
  if (!cfg.enabled || !sender) return "DISABLED";
  if (recipient?.notificationPrefs?.email === false) return "SKIPPED_PREFERENCE";
  if (!recipient?.email) return "SKIPPED_NO_ADDRESS";
  try {
    const { subject, text } = renderEmail(n, cfg.appUrl);
    await sender.send({ to: recipient.email, subject, text });
    return "SENT";
  } catch (e) {
    console.error(JSON.stringify({ level: "error", message: "email delivery failed", error: String(e) }));
    return "FAILED";
  }
};
