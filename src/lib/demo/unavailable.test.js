import { describe, it, expect } from "vitest";
import { classifyCommand, quietAnswer, noticeFor } from "./unavailable.js";

describe("classifyCommand", () => {
  it("treats boot-time status reads as quiet", () => {
    for (const cmd of ["sync_status", "sync_quota", "check_encryption_status",
                       "sync_relay_health", "sync_list_devices", "sync_error_history",
                       "sync_account_email_status"]) {
      expect(classifyCommand(cmd)).toBe("quiet");
    }
  });

  it("treats deliberate acts as noticed", () => {
    for (const cmd of ["sync_setup", "pair_new_join", "setup_encryption",
                       "backup_database_gui", "export_pages_gui", "attachment_add"]) {
      expect(classifyCommand(cmd)).toBe("noticed");
    }
  });

  it("lets everything else run against the mock", () => {
    for (const cmd of ["get_or_create_today", "save_page_content", "create_pin",
                       "search_pages", "delete_all_data"]) {
      expect(classifyCommand(cmd)).toBe("normal");
    }
  });
});

describe("quietAnswer", () => {
  it("answers list-shaped reads with an empty list", () => {
    // Empty is the honest answer, not a stub: no devices are paired in a
    // browser demo, and the settings panel renders its ordinary
    // nothing-set-up state from exactly this.
    expect(quietAnswer("sync_list_devices")).toEqual([]);
    expect(quietAnswer("sync_error_history")).toEqual([]);
  });

  it("answers status reads as not set up", () => {
    expect(quietAnswer("sync_status")).toEqual({ enabled: false, configured: false });
    expect(quietAnswer("sync_quota")).toEqual({ used: 0, cap: null, tier: "free" });
  });

  it("answers check_encryption_status as a boolean false, not a truthy object", () => {
    // This matters: the app at App.svelte:147 does
    // isEncrypted = await checkEncryptionStatus(); if (isEncrypted) isLocked = true;
    // and treats the answer as a boolean. An object is always truthy in JS, so
    // returning { configured: false } would lock every visitor out on boot. The
    // quietAnswer function must pass primitives through untouched, not spread them.
    expect(quietAnswer("check_encryption_status")).toBe(false);
    expect(quietAnswer("check_encryption_status")).not.toBeTruthy();
  });
});

describe("noticeFor", () => {
  it("explains sync in one line, with no notice for a normal command", () => {
    expect(noticeFor("sync_setup").text).toMatch(/installed app/);
    expect(noticeFor("get_or_create_today")).toBeNull();
  });

  it("gives file picking its own line rather than the sync one", () => {
    expect(noticeFor("attachment_add").text).toMatch(/adding files/);
  });

  it("uses no retired or forbidden words anywhere in its copy", () => {
    for (const cmd of ["sync_setup", "attachment_add", "export_pages_gui"]) {
      expect(noticeFor(cmd).text).not.toMatch(/\b(sink|sinks|sinking|sunk)\b/i);
      expect(noticeFor(cmd).text).not.toMatch(/[—!]/);
    }
  });
});
