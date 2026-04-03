import Twilio from "twilio";

export type SmsSendResult = {
  to: string;
  ok: boolean;
  status: "sent" | "failed" | "skipped";
  messageSid?: string;
  error?: string;
  errorCode?: string | number;
};

function normalizePhone(input: string): string {
  return String(input || "").trim();
}

function twilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const from =
    process.env.TWILIO_FROM_NUMBER ||
    process.env.TWILIO_PHONE_NUMBER ||
    "";
  const enabled = Boolean(accountSid && authToken && from);
  return { enabled, accountSid, authToken, from };
}

let twilioClient: ReturnType<typeof Twilio> | null = null;
let twilioClientKey = "";

function getTwilioClient(accountSid: string, authToken: string) {
  const key = `${accountSid}:${authToken.slice(0, 8)}`;
  if (!twilioClient || twilioClientKey !== key) {
    twilioClient = Twilio(accountSid, authToken);
    twilioClientKey = key;
  }
  return twilioClient;
}

function isRetryableSmsError(e: any): boolean {
  const msg = String(e?.message || e || "");
  const code = e?.code;
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE") return true;
  if (/ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|socket hang up|TLS|SSL/i.test(msg)) return true;
  if (typeof e?.status === "number" && e.status >= 500) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function sendSms(toRaw: string, body: string): Promise<SmsSendResult> {
  const to = normalizePhone(toRaw);
  if (!to) {
    return { to: toRaw, ok: false, status: "failed", error: "Missing phone number" };
  }

  const cfg = twilioConfig();
  if (!cfg.enabled) {
    console.log("📨 [SMS] Twilio not configured; skipping send", {
      to,
      hasAccountSid: Boolean(cfg.accountSid),
      hasAuthToken: Boolean(cfg.authToken),
      hasFrom: Boolean(cfg.from),
    });
    return { to, ok: true, status: "skipped" };
  }

  const client = getTwilioClient(cfg.accountSid, cfg.authToken);
  const maxAttempts = 3;
  let lastErr: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const msg = await client.messages.create({
        from: cfg.from,
        to,
        body,
      });
      if (attempt > 1) {
        console.log(`📨 [SMS] Sent to ${to} on attempt ${attempt}`);
      }
      return { to, ok: true, status: "sent", messageSid: msg.sid };
    } catch (e: any) {
      lastErr = e;
      if (attempt < maxAttempts && isRetryableSmsError(e)) {
        const delay = 400 * attempt;
        console.warn(`📨 [SMS] ${to} attempt ${attempt} failed (${e?.code || e?.message}), retry in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      break;
    }
  }

  return {
    to,
    ok: false,
    status: "failed",
    error: lastErr?.message || "Failed to send SMS",
    errorCode: lastErr?.code || lastErr?.status || undefined,
  };
}
