import { describe, it, expect } from "vitest";
import { isBlockedIp, isBlockedDomain, validateUrlSsrf } from "../src/utils/ssrf-guard.js";

describe("SSRF Guard", () => {
  describe("isBlockedIp", () => {
    it("blocks localhost IPv4", () => {
      expect(isBlockedIp("127.0.0.1").blocked).toBe(true);
      expect(isBlockedIp("127.0.0.2").blocked).toBe(true);
    });

    it("blocks private class A", () => {
      expect(isBlockedIp("10.0.0.1").blocked).toBe(true);
      expect(isBlockedIp("10.255.255.255").blocked).toBe(true);
    });

    it("blocks private class B", () => {
      expect(isBlockedIp("172.16.0.1").blocked).toBe(true);
      expect(isBlockedIp("172.31.255.255").blocked).toBe(true);
    });

    it("allows non-private 172.x", () => {
      expect(isBlockedIp("172.15.0.1").blocked).toBe(false);
      expect(isBlockedIp("172.32.0.1").blocked).toBe(false);
    });

    it("blocks private class C", () => {
      expect(isBlockedIp("192.168.0.1").blocked).toBe(true);
      expect(isBlockedIp("192.168.1.100").blocked).toBe(true);
    });

    it("blocks link-local", () => {
      expect(isBlockedIp("169.254.0.1").blocked).toBe(true);
    });

    it("blocks cloud metadata IP", () => {
      expect(isBlockedIp("169.254.169.254").blocked).toBe(true);
    });

    it("allows public IPs", () => {
      expect(isBlockedIp("8.8.8.8").blocked).toBe(false);
      expect(isBlockedIp("1.1.1.1").blocked).toBe(false);
      expect(isBlockedIp("203.0.113.1").blocked).toBe(false);
    });
  });

  describe("isBlockedDomain", () => {
    it("blocks localhost", () => {
      expect(isBlockedDomain("localhost").blocked).toBe(true);
    });

    it("blocks .local domains", () => {
      expect(isBlockedDomain("myserver.local").blocked).toBe(true);
      expect(isBlockedDomain("printer.local").blocked).toBe(true);
    });

    it("blocks .internal domains", () => {
      expect(isBlockedDomain("api.internal").blocked).toBe(true);
    });

    it("allows public domains", () => {
      expect(isBlockedDomain("google.com").blocked).toBe(false);
      expect(isBlockedDomain("example.org").blocked).toBe(false);
    });
  });

  describe("validateUrlSsrf", () => {
    it("rejects non-http protocols", async () => {
      const result = await validateUrlSsrf("file:///etc/passwd");
      expect(result.allowed).toBe(false);
    });

    it("rejects ftp protocol", async () => {
      const result = await validateUrlSsrf("ftp://internal-server/data");
      expect(result.allowed).toBe(false);
    });

    it("rejects localhost URLs", async () => {
      const result = await validateUrlSsrf("http://localhost:8080/api");
      expect(result.allowed).toBe(false);
    });

    it("rejects .local URLs", async () => {
      const result = await validateUrlSsrf("http://mynas.local/share");
      expect(result.allowed).toBe(false);
    });

    it("rejects private IPs in URLs", async () => {
      const result = await validateUrlSsrf("http://192.168.1.1/admin");
      expect(result.allowed).toBe(false);
    });

    it("allows public URLs", async () => {
      const result = await validateUrlSsrf("https://www.google.com/search?q=test");
      expect(result.allowed).toBe(true);
    });

    it("rejects invalid URLs", async () => {
      const result = await validateUrlSsrf("not a url");
      expect(result.allowed).toBe(false);
    });
  });
});
