import { describe, expect, test } from "bun:test";
import { ActionPlan } from "../src/action-plan.ts";

describe("ActionPlan", () => {
  test("formats ordered stages without executing anything", () => {
    const plan = new ActionPlan().add("local", "validate").add("github", "publish");
    expect(plan.format()).toBe("1. [local] validate\n2. [github] publish");
  });

  test("formats an empty plan", () => {
    expect(new ActionPlan().format()).toBe("No actions.");
  });
});
