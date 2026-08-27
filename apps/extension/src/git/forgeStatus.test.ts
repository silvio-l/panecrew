import { describe, expect, it } from "vitest";
import { aggregateCiStatus } from "./forgeStatus";

describe("aggregateCiStatus", () => {
  it("is unknown with no checks at all", () => {
    expect(aggregateCiStatus([])).toBe("unknown");
  });

  it("is passing when every check succeeded", () => {
    expect(aggregateCiStatus([{ state: "SUCCESS" }, { conclusion: "SUCCESS" }])).toBe("passing");
  });

  it("is failing when any check failed, even if others passed", () => {
    expect(aggregateCiStatus([{ state: "SUCCESS" }, { state: "FAILURE" }])).toBe("failing");
  });

  it("is failing when any modern check-run's conclusion failed", () => {
    expect(aggregateCiStatus([{ status: "COMPLETED", conclusion: "FAILURE" }])).toBe("failing");
  });

  it("is running when a check is still in progress and nothing failed yet", () => {
    expect(aggregateCiStatus([{ state: "SUCCESS" }, { state: "PENDING" }])).toBe("running");
  });

  it("prefers failing over running when both are present", () => {
    expect(aggregateCiStatus([{ state: "FAILURE" }, { state: "PENDING" }])).toBe("failing");
  });

  it("treats a check-run with no conclusion yet as still running", () => {
    expect(aggregateCiStatus([{ status: "IN_PROGRESS", conclusion: null }])).toBe("running");
  });
});
