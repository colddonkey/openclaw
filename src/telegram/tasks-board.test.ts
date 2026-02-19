import { describe, expect, it } from "vitest";
import { parseTaskCallback, STATUS_CODES } from "./tasks-board.js";

describe("parseTaskCallback", () => {
  it("parses board action", () => {
    expect(parseTaskCallback("tsk_brd")).toEqual({ action: "board" });
  });

  it("parses my_tasks action", () => {
    expect(parseTaskCallback("tsk_my")).toEqual({ action: "my_tasks" });
  });

  it("parses list action", () => {
    expect(parseTaskCallback("tsk_ls_backlog")).toEqual({
      action: "list",
      status: "backlog",
    });
  });

  it("parses view action", () => {
    expect(parseTaskCallback("tsk_vw_abc123")).toEqual({
      action: "view",
      shortId: "abc123",
    });
  });

  it("parses move action", () => {
    expect(parseTaskCallback("tsk_mv_abc123_don")).toEqual({
      action: "move",
      shortId: "abc123",
      statusCode: "don",
      status: "done",
    });
  });

  it("parses move to in_progress", () => {
    expect(parseTaskCallback("tsk_mv_abc123_inp")).toEqual({
      action: "move",
      shortId: "abc123",
      statusCode: "inp",
      status: "in_progress",
    });
  });

  it("returns null for non-task callbacks", () => {
    expect(parseTaskCallback("mdl_prov")).toBeNull();
    expect(parseTaskCallback("commands_page_1")).toBeNull();
    expect(parseTaskCallback("")).toBeNull();
  });

  it("returns null for malformed task callbacks", () => {
    expect(parseTaskCallback("tsk_unknown")).toBeNull();
    expect(parseTaskCallback("tsk_mv_nocode")).toBeNull();
  });
});

describe("STATUS_CODES", () => {
  it("maps all expected codes", () => {
    expect(STATUS_CODES.bkl).toBe("backlog");
    expect(STATUS_CODES.rdy).toBe("ready");
    expect(STATUS_CODES.inp).toBe("in_progress");
    expect(STATUS_CODES.blk).toBe("blocked");
    expect(STATUS_CODES.rev).toBe("review");
    expect(STATUS_CODES.don).toBe("done");
    expect(STATUS_CODES.arc).toBe("archived");
  });
});
