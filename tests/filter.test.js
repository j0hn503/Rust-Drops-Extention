const { dropMatchesQuery } = require("../drop-filter");

describe("dropMatchesQuery", () => {
  const drop = {
    name: "Large Wood Box",
    displayName: "Large Wood Box (ironmouse)",
    campaign: "Rust Drops",
    streamers: [{ name: "ironmouse" }, { name: "shroud" }]
  };

  test("empty query matches everything", () => {
    expect(dropMatchesQuery(drop, "")).toBe(true);
    expect(dropMatchesQuery(drop, "   ")).toBe(true);
  });

  test("matches drop name case-insensitively", () => {
    expect(dropMatchesQuery(drop, "wood")).toBe(true);
    expect(dropMatchesQuery(drop, "WOOD BOX")).toBe(true);
  });

  test("matches streamer names", () => {
    expect(dropMatchesQuery(drop, "shroud")).toBe(true);
    expect(dropMatchesQuery(drop, "IRON")).toBe(true);
  });

  test("rejects unrelated text", () => {
    expect(dropMatchesQuery(drop, "ak47")).toBe(false);
  });

  test("null drop never matches a real query", () => {
    expect(dropMatchesQuery(null, "box")).toBe(false);
  });
});
