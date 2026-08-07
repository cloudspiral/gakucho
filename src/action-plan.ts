import type { ActionStep } from "./types.ts";

export class ActionPlan {
  readonly steps: ActionStep[] = [];

  add(stage: string, description: string): this {
    this.steps.push({ stage, description });
    return this;
  }

  format(): string {
    if (this.steps.length === 0) return "No actions.";
    return this.steps
      .map((step, index) => `${index + 1}. [${step.stage}] ${step.description}`)
      .join("\n");
  }
}
