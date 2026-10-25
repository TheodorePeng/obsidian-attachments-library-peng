import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import { analyzeBaseExpressions } from '../src/base-formulas.ts';

const TSNOTES = 'if(note["URL-TSNotes"],link(note["URL-TSNotes"],icon("play")),"")';

function rowsOf(entries) {
  return entries.map(([path, properties]) => ({ path, properties }));
}

test('TSNotes formula handles remote, missing and local rows', () => {
  const rows = rowsOf([
    ['remote.md', { 'URL-TSNotes': 'https://example.com/watch?v=1' }],
    ['missing.md', {}],
    ['local.md', { 'URL-TSNotes': 'Library/Video A.md' }],
  ]);
  const result = analyzeBaseExpressions({ TSNotes: TSNOTES }, rows);

  // Remote URL is kept unchanged; the caller resolves/excludes remote targets.
  assert.deepEqual(
    result.links.map((l) => [l.target, l.rowPath]),
    [
      ['https://example.com/watch?v=1', 'remote.md'],
      ['Library/Video A.md', 'local.md'],
    ],
  );
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.dependencies, ['URL-TSNotes']);
});

test('constant formulas still produce links with no rows', () => {
  const result = analyzeBaseExpressions({ Cover: 'link("Note A")' }, []);
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].target, 'Note A');
  assert.equal(result.links[0].formula, 'Cover');
  assert.equal(result.links[0].rowPath, undefined);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.dependencies, []);
});

test('formula aliases resolve nested formulas as targets', () => {
  const formulas = {
    inner: 'note["URL"]',
    outer: 'formula.inner',
    main: 'link(formula.outer)',
  };
  const rows = rowsOf([['a.md', { URL: 'Target.md' }]]);
  const result = analyzeBaseExpressions(formulas, rows);
  assert.deepEqual(
    result.links.map((l) => [l.target, l.formula]),
    [['Target.md', 'main']],
  );
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.dependencies, ['URL']);
});

test('recursive formula cycles are reported as issues, not silent empties', () => {
  const formulas = { a: 'link(formula.b)', b: 'link(formula.a)' };
  const result = analyzeBaseExpressions(formulas, rowsOf([['x.md', {}]]));
  assert.equal(result.links.length, 0);
  assert.ok(result.issues.some((issue) => /cycle/i.test(issue.reason)));
});

test('property changes across rows change the collected targets', () => {
  const formulas = { Link: 'link(note["URL"])' };
  const before = analyzeBaseExpressions(
    formulas,
    rowsOf([['a.md', { URL: 'Old.md' }], ['b.md', { URL: 'Old.md' }]]),
  );
  assert.deepEqual(before.links.map((l) => l.target), ['Old.md', 'Old.md']);

  const after = analyzeBaseExpressions(
    formulas,
    rowsOf([['a.md', { URL: 'New.md' }], ['b.md', {}]]),
  );
  assert.deepEqual(
    after.links.map((l) => [l.target, l.rowPath]),
    [['New.md', 'a.md']],
  );
  // Missing property is null: a bare link() over it is an unusable target.
  assert.ok(after.issues.some((issue) => /not a usable string/i.test(issue.reason)));
  assert.deepEqual(after.dependencies, ['URL']);
});

test('if with a known condition evaluates only the reachable branch', () => {
  const formulas = {
    ShortCircuit: 'if(true, link("kept.md"), link(unknownFn()))',
  };
  const result = analyzeBaseExpressions(formulas, rowsOf([['x.md', {}]]));
  assert.deepEqual(
    result.links.map((l) => l.target),
    ['kept.md'],
  );
  // The unreachable branch was never evaluated: no unsupported-function issue.
  assert.deepEqual(result.issues, []);
});

test('unknown condition unions finite branches without uncertainty', () => {
  const formulas = {
    Either: 'if(formula.missingAlias, link("a.md"), link("b.md"))',
  };
  const result = analyzeBaseExpressions(formulas, rowsOf([['x.md', {}]]));
  assert.deepEqual(
    result.links.map((l) => l.target).sort(),
    ['a.md', 'b.md'],
  );
  assert.deepEqual(result.issues, []);
});

test('unknown display expressions do not cause issues', () => {
  const formulas = {
    Cover: 'link(note["URL"], unknownDisplayFn(note["Label"]))',
  };
  const rows = rowsOf([['a.md', { URL: 'Target.md', Label: 'Hi' }]]);
  const result = analyzeBaseExpressions(formulas, rows);
  assert.deepEqual(
    result.links.map((l) => l.target),
    ['Target.md'],
  );
  assert.deepEqual(result.issues, []);
});

test('string concatenation joins finite known scalars', () => {
  const formulas = {
    Joined: 'link("Library/" + note["Name"] + ".md")',
  };
  const rows = rowsOf([['a.md', { Name: 'Video' }]]);
  const result = analyzeBaseExpressions(formulas, rows);
  assert.deepEqual(
    result.links.map((l) => l.target),
    ['Library/Video.md'],
  );
  assert.deepEqual(result.issues, []);
});

test('malformed syntax is reported as an issue', () => {
  const formulas = {
    Broken: 'link(note["URL"',
    AlsoBroken: 'link(note.URL])',
  };
  const result = analyzeBaseExpressions(formulas, rowsOf([['a.md', { URL: 'x.md' }]]));
  assert.equal(result.links.length, 0);
  const malformed = result.issues.filter((issue) => issue.reason === 'malformed syntax');
  assert.equal(malformed.length, 2);
  assert.ok(malformed.some((issue) => issue.formula === 'Broken'));
  assert.ok(malformed.some((issue) => issue.formula === 'AlsoBroken'));
});

test('malicious function text is never executed', () => {
  let executed = false;
  const formulas = {
    Evil: 'link(({}).constructor.constructor("executed = true")())',
    Eval: 'eval("executed = true")',
  };
  const result = analyzeBaseExpressions(formulas, rowsOf([['a.md', {}]]));
  assert.equal(executed, false);
  assert.equal(result.links.length, 0);
  assert.ok(result.issues.some((issue) => issue.reason === 'malformed syntax'));
  assert.ok(result.issues.some((issue) => /unsupported function "eval"/.test(issue.reason)));
});

test('only own properties are read; prototypes are never traversed', () => {
  const polluted = Object.create({ poisoned: 'evil.md' });
  polluted.clean = 'safe.md';
  const rows = [{ path: 'a.md', properties: polluted }];
  const formulas = {
    Cover: 'if(note["poisoned"], link(note["poisoned"]), "")',
    Own: 'link(note["clean"])',
    BuiltIn: 'if(note["toString"], link(note["toString"]), "")',
  };
  const result = analyzeBaseExpressions(formulas, rows);
  assert.deepEqual(
    result.links.map((l) => l.target),
    ['safe.md'],
  );
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.dependencies, ['clean', 'poisoned', 'toString']);
});

test('inputs are never mutated', () => {
  const formulas = Object.freeze({ Cover: 'link(note["URL"])' });
  const rowProperties = Object.freeze({ URL: 'Target.md' });
  const rows = Object.freeze([Object.freeze({ path: 'a.md', properties: rowProperties })]);
  const snapshot = JSON.stringify({ formulas, rows });

  const result = analyzeBaseExpressions(formulas, rows);

  assert.equal(JSON.stringify({ formulas, rows }), snapshot);
  assert.deepEqual(
    result.links.map((l) => l.target),
    ['Target.md'],
  );
});

test('unknown target computation produces an issue, not an empty success', () => {
  const formulas = { Cover: 'link(formula.nope)' };
  const result = analyzeBaseExpressions(formulas, rowsOf([['a.md', {}]]));
  assert.equal(result.links.length, 0);
  assert.ok(result.issues.some((issue) => /could not be determined|could not be fully determined/.test(issue.reason)));
});

test('links and dependencies are deduplicated', () => {
  const formulas = {
    Dup: 'if(note["Flag"], link("same.md"), link("same.md")) + link("same.md", "")',
  };
  const rows = rowsOf([['a.md', { Flag: true }], ['b.md', { Flag: false }]]);
  const result = analyzeBaseExpressions(formulas, rows);
  const keys = result.links.map((l) => `${l.target}|${l.formula}|${l.rowPath}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(result.links.filter((l) => l.rowPath === 'a.md').length, 1);
  assert.deepEqual(result.dependencies, ['Flag']);
});

test('rejects malformed or unsupported syntax instead of inventing a safe target', () => {
  const invalid = ['', 'link("a") "b"', 'link("a"', 'link("unterminated)', 'link("x\\', 'link("\\q")', 'link("\\u12")', 'link(note.)', 'link(note[2])', 'link(note["x")', 'link(note.a.b)', 'link(formula.a.b)', 'link(note)', 'link(formula)', 'link(thing)', 'link(,)', 'link(@)', 'link("x",)', 'link(' + '9'.repeat(400) + ')'];
  for (const source of invalid) {
    const result = analyzeBaseExpressions({ main: source }, []);
    assert.equal(result.links.length, 0, source);
    assert.ok(result.issues.some(i => i.reason === 'malformed syntax'), source);
  }
});
test('preserves literal escapes, Unicode, whitespace, dotted keys and numeric string conversion', () => {
  const result = analyzeBaseExpressions({ main: '\t\r\nlink(("\\u4e2d\\\\folder/" + note["a.b"] + 12.5), "\\n\\r\\t\\b\\f\\\"\\\'")' }, [{ path: 'a.md', properties: { 'a.b': '图' } }]);
  assert.deepEqual(result.links.map(l => l.target), ['中\\folder/图12.5']); assert.deepEqual(result.issues, []);
  assert.deepEqual(analyzeBaseExpressions({ main: "link('a\\\'b.png')" }, []).links.map(l => l.target), ["a'b.png"]);
});
test('fails closed for wrong argument counts and non-string targets', () => {
  for (const source of ['if()', 'if(true)', 'if(true,1,2,3)', 'link()', 'file("a","b","c")', 'icon()', 'icon("a","b")', 'link(42)', 'link(null)', 'link(false)', 'link("")', 'link(icon("play"))', 'link(this.file)', 'link(note[""])', 'link(true + "x")', 'link(1 + 2)', 'link(if(this, "x", "y") + ".png")']) {
    const result = analyzeBaseExpressions({ main: source }, []); assert.ok(result.issues.length > 0, source);
  }
  assert.deepEqual(analyzeBaseExpressions({ main: 'if(false, link("a"))' }, []).links, []);
  assert.deepEqual(analyzeBaseExpressions({ main: 'if(0, link("a"), image("b"))' }, []).links.map(l => l.target), ['b']);
  assert.deepEqual(analyzeBaseExpressions({ main: 'if(null, link("a"), file("b"))' }, []).links.map(l => l.target), ['b']);
  assert.deepEqual(analyzeBaseExpressions({ main: 'if("", link("a"), file("b"))' }, []).links.map(l => l.target), ['b']);
});
test('handles row scalar types without traversing objects, functions or nonfinite numbers', () => {
  for (const value of [undefined, null, false, true, 0, 1, Infinity, {}, [], () => 'bad']) {
    const result = analyzeBaseExpressions({ main: 'link(note.URL)' }, [{ path: 'a.md', properties: { URL: value } }]);
    assert.equal(result.links.length, 0); assert.ok(result.issues.length > 0);
  }
  assert.equal(analyzeBaseExpressions({ main: 'link(note.URL)' }, [{ path: 'a', properties: { URL: 'target' } }, { path: 'a', properties: { URL: 'target' } }]).links.length, 1);
});
test('does not lose tuple-shaped targets or suppress actual unknown targets with aliases', () => {
  const result = analyzeBaseExpressions({ a: 'link(note.URL)', 'a|b': 'link(note.URL)', skip: 42 }, [{ path: 'b|c', properties: { URL: 'c' } }, { path: 'c', properties: { URL: 'b|c' } }]);
  assert.equal(result.links.length, 4);
  assert.deepEqual(analyzeBaseExpressions({ main: 'link(formula["alias"])', alias: '"x"', unrelated: 'unsupported()' }, [], ['main']).issues, []);
  assert.ok(analyzeBaseExpressions({ main: 'link(formula.alias)', alias: 1 }, []).issues.length > 0);
  assert.deepEqual(analyzeBaseExpressions({ main: 'if(unknown(),link("a"),link("b"))' }, []).issues, []);
  assert.deepEqual(analyzeBaseExpressions({ main: 'icon(note.Label)' }, [{ path: 'a', properties: { Label: 'display' } }]).dependencies, ['Label']);
  assert.ok(analyzeBaseExpressions({ main: 'link(if(unknown(),link("a"),bad()))' }, []).issues.length > 0);
});
