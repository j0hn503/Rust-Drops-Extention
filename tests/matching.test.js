// Tests for name matching and drop differentiation logic

// Copy the matching functions from background.js for testing
function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const ABBREV = {
  sm: 'small',
  lg: 'large',
  med: 'medium',
  xl: 'large',
  xxl: 'large',
  ar: 'assault rifle',
  sar: 'semi auto rifle',
  db: 'double barrel',
  tac: 'tactical',
  sg: 'shotgun',
  bp: 'backpack'
};

function tokens(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(t => t && ['rust', 'isles', 'the', 'skin', 'drop', 'twitch'].indexOf(t) === -1)
    .map(t => ABBREV[t] || t);
}

function tokEq(x, y) {
  if (x === y) return true;
  if (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x))) return true;
  return false;
}

function nameMatches(a, b) {
  const na = norm(a),
    nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb || na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) return true;
  let ta = tokens(a),
    tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const short = ta.length <= tb.length ? ta : tb;
  const long = ta.length <= tb.length ? tb : ta;
  let hits = 0;
  for (const t of short) {
    if (long.some(u => tokEq(t, u))) hits++;
  }
  if (hits === short.length) return true;
  const GENERIC = [
    'door',
    'box',
    'hat',
    'pants',
    'boots',
    'gloves',
    'jacket',
    'mask',
    'shirt',
    'vest',
    'helmet',
    'bag',
    'pack',
    'sword',
    'knife',
    'rifle',
    'gun',
    'sign',
    'rug',
    'table',
    'chair',
    'lantern',
    'torch',
    'rock',
    'chest',
    'locker',
    'furnace'
  ];
  if (ta[ta.length - 1] === tb[tb.length - 1] && hits / short.length >= 0.5 && hits / long.length >= 0.5) {
    const need = GENERIC.indexOf(ta[ta.length - 1]) !== -1 ? 0.6 : 0.5;
    if (hits / short.length >= need && hits / long.length >= need) return true;
  }
  return false;
}

describe('Name Matching', () => {
  test('exact match', () => {
    expect(nameMatches('Large Wood Box', 'Large Wood Box')).toBe(true);
  });

  test('case insensitive', () => {
    expect(nameMatches('Large Wood Box', 'large wood box')).toBe(true);
  });

  test('normalization removes special chars', () => {
    expect(nameMatches('Large Wood Box!', 'Large Wood Box')).toBe(true);
  });

  test('abbreviation expansion', () => {
    expect(nameMatches('SM Box', 'Small Box')).toBe(true);
    expect(nameMatches('LG Box', 'Large Box')).toBe(true);
  });

  test('token prefix matching', () => {
    expect(nameMatches('Wooden Door', 'Wood Door')).toBe(true);
  });

  test('partial match', () => {
    expect(nameMatches('Auto Turret', 'Turret')).toBe(true);
  });

  test('generic word matching with threshold', () => {
    expect(nameMatches('Garage Door', 'Wooden Door')).toBe(false); // Should fail due to threshold
  });

  test('no match', () => {
    expect(nameMatches('Auto Turret', 'Wooden Door')).toBe(false);
  });

  test('abbreviation: SAR', () => {
    expect(nameMatches('SAR', 'Semi Auto Rifle')).toBe(true);
  });

  test('abbreviation: DB', () => {
    expect(nameMatches('DB Shotgun', 'Double Barrel Shotgun')).toBe(true);
  });
});

describe('Token Function', () => {
  test('removes common words', () => {
    expect(tokens('Rust Skin Drop Wooden Door')).toEqual(['wooden', 'door']);
  });

  test('expands abbreviations', () => {
    expect(tokens('SM Box')).toEqual(['small', 'box']);
  });

  test('normalizes case', () => {
    expect(tokens('LARGE WOOD BOX')).toEqual(['large', 'wood', 'box']);
  });
});

describe('Normalization', () => {
  test('removes special characters', () => {
    expect(norm('Large Wood Box!')).toBe('largewoodbox');
  });

  test('lowercases', () => {
    expect(norm('LARGE WOOD BOX')).toBe('largewoodbox');
  });

  test('handles empty string', () => {
    expect(norm('')).toBe('');
  });

  test('handles null/undefined', () => {
    expect(norm(null)).toBe('');
    expect(norm(undefined)).toBe('');
  });
});
