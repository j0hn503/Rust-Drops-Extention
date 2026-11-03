const {
  dropMatchesQuery,
  getLiveDropGroups,
  isAutoClaimEligible,
  isGeneralDrop,
  calculateProgressPercent,
  isRustInventoryReward,
  mergeInventoryStatus,
  getRefreshCountdown,
  parseProgressPercent,
  pickProgressDrop
} = require("../drop-filter");

const drop = {
  name: "Large Wood Box",
  displayName: "Large Wood Box (ironmouse)",
  campaign: "Rust Drops",
  streamers: [{ name: "ironmouse" }, { name: "shroud" }]
};

describe("dropMatchesQuery", () => {
  test("empty query matches everything", () => {
    expect(dropMatchesQuery(drop, "")).toBe(true);
    expect(dropMatchesQuery(drop, "   ")).toBe(true);
  });
});

describe("general Rust drop grouping", () => {
  test("recognizes general drops with no streamer list", () => {
    expect(isGeneralDrop({ name: "Rust drop", streamers: [] })).toBe(true);
    expect(isGeneralDrop({ name: "Rust drop", isGeneral: true })).toBe(true);
    expect(isGeneralDrop({ name: "Streamer drop", streamers: [{ name: "channel" }] })).toBe(false);
  });

  test("groups unclaimed general drops into one Live bundle and retains live tracked drops", () => {
    const groups = getLiveDropGroups([
      { name: "General One", isGeneral: true, claimed: false, live: false },
      { name: "General Two", isGeneral: true, claimed: false, live: false },
      { name: "Already Claimed", isGeneral: true, claimed: true, live: false },
      { name: "Streamer Drop", live: true, streamers: [{ name: "channel" }] },
      { name: "Offline Drop", live: false, streamers: [{ name: "other" }] }
    ]);

    expect(groups.general.map((drop) => drop.name)).toEqual(["General One", "General Two"]);
    expect(groups.tracked.map((drop) => drop.name)).toEqual(["Streamer Drop"]);
  });

  test("uses explicit watched fractions for partial and complete progress", () => {
    expect(parseProgressPercent("100/100 watched")).toBe(100);
    expect(parseProgressPercent("50/100 watched")).toBe(50);
    expect(parseProgressPercent("0/100 watched")).toBe(0);
    expect(parseProgressPercent("no progress")).toBeNull();
  });

  test("calculates API progress without dropping zero or complete values", () => {
    expect(calculateProgressPercent(100, 100)).toBe(100);
    expect(calculateProgressPercent(50, 100)).toBe(50);
    expect(calculateProgressPercent(0, 100)).toBe(0);
    expect(calculateProgressPercent(110, 100)).toBe(100);
    expect(calculateProgressPercent(10, 0)).toBeNull();
  });

  test("recognizes current Rust inventory by game, campaign, ID, or exact catalog reward name", () => {
    const catalog = [{ name: "Large Wood Box" }, { name: "Rug" }];
    expect(isRustInventoryReward({ name: "Reward", game: { name: "Rust" } }, catalog)).toBe(true);
    expect(isRustInventoryReward({ name: "Reward", campaign: { name: "Rust Drops" } }, catalog)).toBe(true);
    expect(isRustInventoryReward({ name: "Reward", campaign: { id: "current" } }, catalog, "current")).toBe(true);
    expect(isRustInventoryReward({ name: "Large Wood Box" }, catalog)).toBe(true);
    expect(isRustInventoryReward({ name: "Large Wood Box", game: { name: "Some Other Game" } }, [])).toBe(false);
    expect(isRustInventoryReward({ name: "Rug", game: { name: "Some Other Game" } }, catalog)).toBe(false);
  });

  test("a confirmed claim cannot be reverted by a stale progress refresh", () => {
    const drop = { name: "Rug", claimed: true, pct: 100, progress: "100%" };
    expect(mergeInventoryStatus(drop, { name: "Rug", isClaimed: false, percent: 0 })).toMatchObject({
      claimed: true,
      pct: 100,
      progress: "100%"
    });
  });

  test("counts down to the next scheduled stream refresh without restarting every heartbeat", () => {
    const at = new Date(1_000_000).toISOString();
    expect(getRefreshCountdown({ at, tick: 1 }, 1_020_000, 20)).toEqual({
      progress: 0,
      streams: 20
    });
    expect(getRefreshCountdown({ at, tick: 1 }, 1_040_000, 20)).toEqual({
      progress: 0,
      streams: 0
    });
    expect(getRefreshCountdown({ at, tick: 2 }, 1_020_000, 20)).toEqual({
      progress: 0,
      streams: 0
    });
  });

  test("prefers a General Drop when inventory progress only identifies a reward by name", () => {
    const generalDrop = { name: "Reward", isGeneral: true };
    const streamerDrop = { name: "Reward", streamers: [{ name: "channel" }] };
    expect(pickProgressDrop([streamerDrop, generalDrop])).toBe(generalDrop);
    expect(pickProgressDrop([streamerDrop])).toBe(streamerDrop);
  });
});

describe("automatic claim eligibility", () => {
  const now = 1_000_000;

  test("requires auto-claim enabled and 100% progress", () => {
    expect(isAutoClaimEligible({ pct: 100 }, false, now)).toBe(false);
    expect(isAutoClaimEligible({ pct: 99 }, true, now)).toBe(false);
    expect(isAutoClaimEligible({ pct: 100 }, true, now)).toBe(true);
  });

  test("does not retry during the claim cooldown or claim an already claimed drop", () => {
    expect(isAutoClaimEligible({ pct: 100, _lastClaimTry: now - 1000 }, true, now)).toBe(false);
    expect(isAutoClaimEligible({ pct: 100, _lastClaimTry: now - 6 * 60 * 1000 }, true, now)).toBe(true);
    expect(isAutoClaimEligible({ pct: 100, claimed: true }, true, now)).toBe(false);
  });
});

describe("dropMatchesQuery", () => {
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
