(function (root) {
  function dropMatchesQuery(drop, query) {
    var q = String(query || "")
      .trim()
      .toLowerCase();
    if (!q) return true;
    if (!drop) return false;

    var hay = [drop.displayName, drop.name, drop.campaign];
    if (drop.streamers && drop.streamers.length) {
      for (var i = 0; i < drop.streamers.length; i++) {
        hay.push(drop.streamers[i] && drop.streamers[i].name);
      }
    }

    for (var j = 0; j < hay.length; j++) {
      if (hay[j] && String(hay[j]).toLowerCase().indexOf(q) !== -1) return true;
    }
    return false;
  }

  function isGeneralDrop(drop) {
    return !!(drop && (drop.isGeneral || !drop.streamers || drop.streamers.length === 0));
  }

  function parseProgressPercent(text) {
    var value = String(text || "");
    var fraction = value.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    if (fraction && Number(fraction[2]) > 0) {
      return Math.min(100, Math.round((Number(fraction[1]) / Number(fraction[2])) * 100));
    }
    var percent = value.match(/\b(\d{1,3})\s*%/);
    return percent ? Math.min(100, Number(percent[1])) : null;
  }

  function calculateProgressPercent(earned, required) {
    var watched = Number(earned);
    var target = Number(required);
    if (!Number.isFinite(watched) || !Number.isFinite(target) || target <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((watched / target) * 100)));
  }

  function isRustInventoryReward(item, catalog, campaignId) {
    if (!item || !item.name) return false;
    if (campaignId && item.campaign && item.campaign.id === campaignId) return true;
    if (/rust/i.test((item.game && item.game.name) || "") ||
        /rust/i.test((item.campaign && item.campaign.name) || "")) return true;
    if (item.game && item.game.name) return false;
    var itemName = String(item.name).toLowerCase().replace(/[^a-z0-9]/g, "");
    return (Array.isArray(catalog) ? catalog : []).some(function (drop) {
      return drop && String(drop.name || "").toLowerCase().replace(/[^a-z0-9]/g, "") === itemName;
    });
  }

  function mergeInventoryStatus(drop, entry) {
    if (!drop || !entry) return drop;
    drop.claimed = !!drop.claimed || !!entry.isClaimed;
    drop.facepunchClaimed = drop.claimed;
    if (drop.claimed) {
      drop.pct = 100;
      drop.progress = "100%";
    } else if (entry.percent !== null && entry.percent !== undefined) {
      drop.pct = Number(entry.percent);
      drop.progress = drop.pct + "%";
    }
    if (entry.dropInstanceID) drop.dropInstanceID = entry.dropInstanceID;
    return drop;
  }

  function getRefreshCountdown(heartbeat, now, secondsPerTick) {
    if (!heartbeat || !heartbeat.at) return null;
    var interval = Number(secondsPerTick) || 20;
    var elapsed = Math.max(0, (now - new Date(heartbeat.at).getTime()) / 1000);
    var tick = Number(heartbeat.tick) || 0;
    var ticksToLive = 3 - (tick % 3);
    return {
      progress: Math.max(0, Math.ceil(interval - elapsed)),
      streams: Math.max(0, Math.ceil(ticksToLive * interval - elapsed))
    };
  }

  function pickProgressDrop(candidates) {
    var list = Array.isArray(candidates) ? candidates : [];
    if (!list.length) return null;
    var general = list.filter(isGeneralDrop);
    var pool = general.length ? general : list;
    return pool.find(function (drop) {
      return drop._inProgress || (drop.pct !== null && drop.pct !== undefined);
    }) || pool[0];
  }

  function getLiveDropGroups(drops) {
    var list = Array.isArray(drops) ? drops : [];
    return {
      tracked: list.filter(function (drop) {
        return !isGeneralDrop(drop) && !!drop.live;
      }),
      general: list.filter(function (drop) {
        return isGeneralDrop(drop) && !drop.claimed;
      })
    };
  }

  function isAutoClaimEligible(drop, enabled, now) {
    return !!(
      enabled &&
      drop &&
      !drop.claimed &&
      Number(drop.pct) >= 100 &&
      (!drop._lastClaimTry || now - drop._lastClaimTry > 5 * 60 * 1000)
    );
  }

  var api = {
    dropMatchesQuery: dropMatchesQuery,
    getLiveDropGroups: getLiveDropGroups,
    isGeneralDrop: isGeneralDrop,
    parseProgressPercent: parseProgressPercent,
    calculateProgressPercent: calculateProgressPercent,
    isRustInventoryReward: isRustInventoryReward,
    mergeInventoryStatus: mergeInventoryStatus,
    getRefreshCountdown: getRefreshCountdown,
    pickProgressDrop: pickProgressDrop,
    isAutoClaimEligible: isAutoClaimEligible
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.dropMatchesQuery = dropMatchesQuery;
    root.getLiveDropGroups = getLiveDropGroups;
    root.isGeneralDrop = isGeneralDrop;
    root.parseProgressPercent = parseProgressPercent;
    root.calculateProgressPercent = calculateProgressPercent;
    root.isRustInventoryReward = isRustInventoryReward;
    root.mergeInventoryStatus = mergeInventoryStatus;
    root.getRefreshCountdown = getRefreshCountdown;
    root.pickProgressDrop = pickProgressDrop;
    root.isAutoClaimEligible = isAutoClaimEligible;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
