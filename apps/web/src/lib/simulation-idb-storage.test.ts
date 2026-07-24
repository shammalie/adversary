import { beforeEach, describe, expect, it } from "vitest";

import {
  listScenarios,
  resetSimulationsDbForTests,
  saveScenarioDraft,
} from "@/lib/simulation-idb-storage";

describe("simulation idb storage", () => {
  beforeEach(async () => {
    await resetSimulationsDbForTests();
  });

  it("persists invalid drafts without throwing", async () => {
    const record = await saveScenarioDraft({
      name: "",
      targets: [],
      events: [],
    });

    expect(record.id).toBeTruthy();
    expect(record.name).toBe("Untitled import");

    const stored = await listScenarios();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.payload).toMatchObject({ targets: [], events: [] });
  });

  it("updates an existing record by id", async () => {
    const first = await saveScenarioDraft({ id: "scenario-a", name: "Alpha", targets: [], events: [] });
    const second = await saveScenarioDraft({
      id: "scenario-a",
      name: "Alpha revised",
      targets: [{ id: "t1" }],
      events: [],
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Alpha revised");

    const stored = await listScenarios();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe("Alpha revised");
  });
});
