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

  var api = { dropMatchesQuery: dropMatchesQuery };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.dropMatchesQuery = dropMatchesQuery;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
