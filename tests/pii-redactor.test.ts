import { describe, it, expect } from "vitest";
import { redactPii, detectPiiInQuery } from "../src/utils/pii-redactor.js";

describe("PII Redactor", () => {
  describe("redactPii (balanced)", () => {
    it("redacts email addresses", () => {
      const result = redactPii("Contact us at john@example.com for info", false);
      expect(result.text).toContain("[EMAIL_REDACTED]");
      expect(result.text).not.toContain("john@example.com");
      expect(result.redactions.length).toBeGreaterThan(0);
    });

    it("redacts credit card numbers", () => {
      const result = redactPii("Card: 4111-1111-1111-1111", false);
      expect(result.text).toContain("[CC_REDACTED]");
      expect(result.text).not.toContain("4111");
    });

    it("redacts SSN", () => {
      const result = redactPii("SSN: 123-45-6789", false);
      expect(result.text).toContain("[SSN_REDACTED]");
    });

    it("preserves normal text", () => {
      const result = redactPii("This is a normal search query about TypeScript", false);
      expect(result.text).toBe("This is a normal search query about TypeScript");
      expect(result.redactions).toHaveLength(0);
    });
  });

  describe("redactPii (strict)", () => {
    it("redacts phone numbers in strict mode", () => {
      const result = redactPii("Call 03-1234-5678 for details", true);
      expect(result.text).toContain("[PHONE_REDACTED]");
    });

    it("redacts IP addresses in strict mode", () => {
      const result = redactPii("Server at 203.0.113.50 is down", true);
      expect(result.text).toContain("[IP_REDACTED]");
    });
  });

  describe("detectPiiInQuery", () => {
    it("detects email in query", () => {
      const detected = detectPiiInQuery("search for info about user@test.com");
      expect(detected).toContain("email");
    });

    it("returns empty for safe queries", () => {
      const detected = detectPiiInQuery("what is TypeScript?");
      expect(detected).toHaveLength(0);
    });
  });
});
