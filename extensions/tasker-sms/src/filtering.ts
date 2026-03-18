/**
 * Port of the TextFlow shouldIgnoreMessage + isLikelySpam logic.
 * Drops system notifications and flags marketing/spam.
 */

const IGNORE_PATTERNS = [
  "doing work in the background",
  "is running in the background",
  "running in background",
  "background activity",
  "checking for messages",
  "syncing messages",
  "connecting to",
  "connected to wifi",
  "connected to mobile",
  "charging",
  "battery",
  "screenshot",
  "screen recording",
  "do not disturb",
  "airplane mode",
  "bluetooth",
  "usb debugging",
  "developer options",
  "system update",
  "software update",
  "downloading",
  "download complete",
  "upload complete",
  "backup",
  "google play",
  "app update",
  "security patch",
  "device pairing",
  "your messages are available",
  "messages are available on",
  "paired device",
  "rcs",
  "chat features",
  "enable chat features",
  "verify your number",
  "carrier services",
  "sensitive notification",
  "notification content hidden",
  "call ended",
  "missed call",
  "voicemail",
  "incoming call",
  "outgoing call",
  "call forwarded",
  "call waiting",
  "caller id",
  "call back",
  "your call has been",
  "this call is being",
  "call recording",
  "spam likely",
  "potential spam",
  "scam likely",
  "fraud alert",
  "account alert",
  "payment due",
  "autopay",
  "bill ready",
  "data usage",
  "plan update",
  "verification code",
  "security code",
  "one-time code",
  "otp",
  "log in code",
  "sign in code",
  "2fa",
  "two-factor",
];

const SPAM_PATTERNS = [
  /verification code/i,
  /login code/i,
  /\b\d{4,6}\b.*code/i,
  /OTP/i,
  /one-time/i,
  /unsubscribe/i,
  /reply stop/i,
  /stop to opt.?out/i,
  /text stop to/i,
  /msg.?data rates/i,
  /msg frequency/i,
  /final hours/i,
  /limited time/i,
  /act now/i,
  /expires (today|tonight|soon)/i,
  /\.tv\//i,
  /\.ly\//i,
  /bit\.ly/i,
  /attn\.tv/i,
  /save \$?\d+%?/i,
  /off (your|next)/i,
  /promo code/i,
  /use code/i,
  /flash sale/i,
  /deal ends/i,
];

export function shouldIgnoreMessage(body: string): boolean {
  if (!body || body.trim().length < 3) return true;
  const lower = body.toLowerCase();
  for (const pattern of IGNORE_PATTERNS) {
    if (lower.includes(pattern)) return true;
  }
  return false;
}

export function isLikelySpam(phone: string, body: string, senderName?: string): boolean {
  // Short-code senders (< 10 digits) are almost always automated
  const digitsOnly = phone.replace(/\D/g, "");
  if (digitsOnly.length > 0 && digitsOnly.length < 10) return true;

  const fullText = `${senderName ?? ""} ${body}`;
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(fullText)) return true;
  }
  return false;
}
