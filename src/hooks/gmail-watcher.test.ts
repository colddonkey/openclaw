import { describe, expect, it } from "vitest";
import { isAddressInUseError, isGmailAuthExpiredError } from "./gmail-watcher.js";

describe("isGmailAuthExpiredError", () => {
  it("detects invalid_grant", () => {
    expect(
      isGmailAuthExpiredError(
        `Get "https://gmail.googleapis.com/gmail/v1/users/me/labels": oauth2: "invalid_grant" "Token has been expired or revoked."`,
      ),
    ).toBe(true);
  });

  it("detects token expired variant", () => {
    expect(isGmailAuthExpiredError("Token has been expired or revoked.")).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isGmailAuthExpiredError("connection refused")).toBe(false);
    expect(isGmailAuthExpiredError("address already in use")).toBe(false);
    expect(isGmailAuthExpiredError("")).toBe(false);
  });
});

describe("isAddressInUseError", () => {
  it("detects EADDRINUSE", () => {
    expect(isAddressInUseError("listen EADDRINUSE :::8788")).toBe(true);
  });

  it("detects address already in use text", () => {
    expect(isAddressInUseError("address already in use")).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isAddressInUseError("invalid_grant")).toBe(false);
  });
});
