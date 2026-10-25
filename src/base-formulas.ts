/**
 * Pure analyzer for a limited Base-formula expression language.
 *
 * The analyzer never evaluates JavaScript (no eval/Function), never touches
 * prototypes beyond own-property reads, never invokes values as functions,
 * and never mutates its inputs. It parses each formula into a small AST and
 * interprets it against the caller-provided row superset.
 *
 * Only target positions matter for links: `link(target, display?)`,
 * `image(target)` and `file(target)` collect string targets (external URLs
 * are kept unchanged; the caller resolves or excludes remote targets).
 * Unknown or unusable target computation is reported as an issue rather than
 * silently producing nothing.
 */

export interface BaseFormulaRow {
  path: string;
  properties: Record<string, unknown>;
}

export interface BaseFormulaLink {
  target: string;
  formula: string;
  rowPath?: string;
}

export interface BaseFormulaIssue {
  reason: string;
  formula: string;
  rowPath?: string;
}

export interface BaseFormulaAnalysis {
  links: BaseFormulaLink[];
  issues: BaseFormulaIssue[];
  dependencies: string[];
}

type Scalar = string | number | boolean | null;

/** The finite set of outcomes an expression may produce. */
interface Possibilities {
  /** Deduped scalar values keyed by type + string form. */
  scalars: Map<string, Scalar>;
  /** Link targets collected by link/image/file constructors. */
  targets: Set<string>;
  /** False when the expression may produce outcomes we cannot see. */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'keyword'; value: 'true' | 'false' | 'null' | 'this' }
  | { kind: 'ident'; value: string }
  | { kind: 'punct'; value: '(' | ')' | ',' | '.' | '[' | ']' | '+' };

const PUNCTUATION = new Set(['(', ')', ',', '.', '[', ']', '+']);
const KEYWORDS = new Set(['true', 'false', 'null', 'this']);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let value = '';
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === '\\') {
          i += 1;
          if (i >= source.length) throw new Error('unterminated string literal');
          const escaped = source[i];
          const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', "'": "'", '"': '"' };
          if (escaped === 'u') {
            const digits = source.slice(i + 1, i + 5);
            if (!/^[0-9a-f]{4}$/i.test(digits)) throw new Error('invalid Unicode escape');
            value += String.fromCharCode(parseInt(digits, 16)); i += 5; continue;
          }
          if (!Object.prototype.hasOwnProperty.call(escapes, escaped)) throw new Error('unsupported string escape');
          value += escapes[escaped]; i += 1; continue;
        }
        value += source[i];
        i += 1;
      }
      if (i >= source.length) throw new Error('unterminated string literal');
      i += 1;
      tokens.push({ kind: 'string', value });
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let raw = '';
      while (i < source.length && source[i] >= '0' && source[i] <= '9') {
        raw += source[i];
        i += 1;
      }
      if (source[i] === '.' && source[i + 1] >= '0' && source[i + 1] <= '9') {
        raw += '.';
        i += 1;
        while (i < source.length && source[i] >= '0' && source[i] <= '9') {
          raw += source[i];
          i += 1;
        }
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`invalid number "${raw}"`);
      tokens.push({ kind: 'number', value });
      continue;
    }
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let word = '';
      while (
        i < source.length &&
        ((source[i] >= 'a' && source[i] <= 'z') ||
          (source[i] >= 'A' && source[i] <= 'Z') ||
          (source[i] >= '0' && source[i] <= '9') ||
          source[i] === '_')
      ) {
        word += source[i];
        i += 1;
      }
      if (KEYWORDS.has(word)) {
        tokens.push({ kind: 'keyword', value: word as 'true' | 'false' | 'null' | 'this' });
      } else {
        tokens.push({ kind: 'ident', value: word });
      }
      continue;
    }
    if (PUNCTUATION.has(ch)) {
      tokens.push({ kind: 'punct', value: ch as '(' | ')' | ',' | '.' | '[' | ']' | '+' });
      i += 1;
      continue;
    }
    throw new Error(`unexpected character "${ch}"`);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type Expr =
  | { type: 'literal'; value: Scalar }
  | { type: 'row-prop'; name: string }
  | { type: 'formula-ref'; name: string }
  | { type: 'this-context' }
  | { type: 'call'; name: string; args: Expr[] }
  | { type: 'concat'; left: Expr; right: Expr };

class Parser {
  private position = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parseFormula(): Expr {
    const expr = this.parseExpression();
    if (this.peek() !== undefined) {
      throw new Error('unexpected trailing input');
    }
    return expr;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private take(): Token | undefined {
    const token = this.tokens[this.position];
    this.position += 1;
    return token;
  }

  private expectPunctuation(value: Token['value'] & string): void {
    const token = this.take();
    if (!token || token.kind !== 'punct' || token.value !== value) {
      throw new Error(`expected "${value}"`);
    }
  }

  parseExpression(): Expr {
    let left = this.parsePrimary();
    while (this.peek()?.kind === 'punct' && this.peek()?.value === '+') {
      this.take();
      const right = this.parsePrimary();
      left = { type: 'concat', left, right };
    }
    return left;
  }

  private parsePrimary(): Expr {
    const token = this.take();
    if (!token) throw new Error('unexpected end of input');

    if (token.kind === 'string') return { type: 'literal', value: token.value };
    if (token.kind === 'number') return { type: 'literal', value: token.value };
    if (token.kind === 'keyword') {
      if (token.value === 'this') {
        this.consumePostfixes();
        return { type: 'this-context' };
      }
      if (token.value === 'true') return { type: 'literal', value: true };
      if (token.value === 'false') return { type: 'literal', value: false };
      return { type: 'literal', value: null };
    }
    if (token.kind === 'punct' && token.value === '(') {
      const expr = this.parseExpression();
      this.expectPunctuation(')');
      return expr;
    }
    if (token.kind === 'ident') {
      if (this.peek()?.kind === 'punct' && this.peek()?.value === '(') {
        this.take();
        const args: Expr[] = [];
        if (!(this.peek()?.kind === 'punct' && this.peek()?.value === ')')) {
          args.push(this.parseExpression());
          while (this.peek()?.kind === 'punct' && this.peek()?.value === ',') {
            this.take();
            args.push(this.parseExpression());
          }
        }
        this.expectPunctuation(')');
        return { type: 'call', name: token.value, args };
      }
      if (token.value === 'note') {
        const segments = this.consumePostfixes();
        if (segments.length !== 1) throw new Error('unsupported nested property access');
        return { type: 'row-prop', name: segments[0] };
      }
      if (token.value === 'formula') {
        const segments = this.consumePostfixes();
        if (segments.length !== 1) throw new Error('unsupported nested formula access');
        return { type: 'formula-ref', name: segments[0] };
      }
      throw new Error(`unknown identifier "${token.value}"`);
    }
    throw new Error(`unexpected token "${JSON.stringify(token)}"`);
  }

  /** Consumes `.name` / `["name"]` chains and returns the segment list. */
  private consumePostfixes(): string[] {
    const segments: string[] = [];
    for (;;) {
      const next = this.peek();
      if (next?.kind === 'punct' && next.value === '.') {
        this.take();
        const ident = this.take();
        if (!ident || ident.kind !== 'ident') throw new Error('expected identifier after "."');
        segments.push(ident.value);
      } else if (next?.kind === 'punct' && next.value === '[') {
        this.take();
        const key = this.take();
        if (!key || key.kind !== 'string') throw new Error('expected string key after "["');
        this.expectPunctuation(']');
        segments.push(key.value);
      } else {
        break;
      }
    }
    return segments;
  }
}

function parseFormula(source: string): Expr {
  return new Parser(tokenize(source)).parseFormula();
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) === true;
}

function scalarKey(value: Scalar): string {
  return `${typeof value}:${String(value)}`;
}

function completeScalar(value: Scalar): Possibilities {
  return { scalars: new Map([[scalarKey(value), value]]), targets: new Set(), complete: true };
}

function unknownPossibilities(targets?: Iterable<string>): Possibilities {
  return {
    scalars: new Map(),
    targets: new Set(targets ?? []),
    complete: false,
  };
}

function unionPossibilities(a: Possibilities, b: Possibilities): Possibilities {
  const scalars = new Map(a.scalars);
  for (const [key, value] of b.scalars) scalars.set(key, value);
  const targets = new Set(a.targets);
  for (const target of b.targets) targets.add(target);
  return { scalars, targets, complete: a.complete && b.complete };
}

function isScalar(value: unknown): value is Scalar {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  );
}

function truthy(value: Scalar): boolean {
  return value !== null && value !== false && value !== '' && value !== 0;
}

interface EvalState {
  formulas: Record<string, unknown>;
  row: BaseFormulaRow;
  /** Per-(formula, row) memo; 'pending' marks the cycle-detection stack. */
  memo: Map<string, Possibilities | 'pending'>;
  issueMap: Map<string, BaseFormulaIssue>;
  dependencies: Set<string>;
  hasRealRows: boolean;
  /** > 0 while evaluating display positions, where issues are suppressed. */
  displayDepth: number;
}

function reportIssue(state: EvalState, reason: string, formula: string): void {
  if (state.displayDepth > 0) return;
  const rowPath = state.hasRealRows ? state.row.path : undefined;
  const key = JSON.stringify([reason, formula, rowPath]);
  if (!state.issueMap.has(key)) {
    const issue: BaseFormulaIssue = { reason, formula };
    if (rowPath !== undefined) issue.rowPath = rowPath;
    state.issueMap.set(key, issue);
  }
}

function evaluateFormulaByName(name: string, state: EvalState, rootName: string): Possibilities {
  const cached = state.memo.get(name);
  if (cached === 'pending') {
    reportIssue(state, 'formula cycle detected', rootName);
    return unknownPossibilities();
  }
  if (cached) return cached;
  if (!hasOwn(state.formulas, name) || typeof state.formulas[name] !== 'string') {
    return unknownPossibilities();
  }
  let expr: Expr;
  try {
    expr = parseFormula(state.formulas[name]);
  } catch {
    reportIssue(state, 'malformed syntax', name);
    return unknownPossibilities();
  }
  state.memo.set(name, 'pending');
  const value = evaluateExpr(expr, state, rootName);
  state.memo.set(name, value);
  return value;
}

function evaluateExpr(expr: Expr, state: EvalState, rootName: string): Possibilities {
  switch (expr.type) {
    case 'literal':
      return completeScalar(expr.value);
    case 'row-prop':
      return evaluateRowProperty(expr.name, state);
    case 'formula-ref':
      return evaluateFormulaByName(expr.name, state, rootName);
    case 'this-context':
      reportIssue(state, 'this-context expressions are not supported', rootName);
      return unknownPossibilities();
    case 'concat':
      return evaluateConcat(expr, state, rootName);
    case 'call':
      return evaluateCall(expr, state, rootName);
  }
}

function evaluateRowProperty(name: string, state: EvalState): Possibilities {
  if (name === '') return unknownPossibilities();
  state.dependencies.add(name);
  if (!hasOwn(state.row.properties, name)) return completeScalar(null);
  const value: unknown = state.row.properties[name];
  if (value === undefined) return completeScalar(null);
  if (typeof value === 'number' && !Number.isFinite(value)) return unknownPossibilities();
  if (isScalar(value)) return completeScalar(value);
  // Objects, arrays and functions are never invoked or traversed.
  return unknownPossibilities();
}

function evaluateConcat(expr: Extract<Expr, { type: 'concat' }>, state: EvalState, rootName: string): Possibilities {
  const left = evaluateExpr(expr.left, state, rootName);
  const right = evaluateExpr(expr.right, state, rootName);
  if (left.complete && right.complete && left.scalars.size === 1 && right.scalars.size === 1) {
    const a = left.scalars.values().next().value as Scalar;
    const b = right.scalars.values().next().value as Scalar;
    if (typeof a === 'number' && typeof b === 'number') return completeScalar(a + b);
    if ((typeof a === 'string' || typeof a === 'number') && (typeof b === 'string' || typeof b === 'number')) {
      return completeScalar(String(a) + String(b));
    }
  }
  return unknownPossibilities(unionPossibilities(left, right).targets);
}

function evaluateCall(expr: Extract<Expr, { type: 'call' }>, state: EvalState, rootName: string): Possibilities {
  switch (expr.name) {
    case 'if':
      return evaluateIf(expr, state, rootName);
    case 'link':
    case 'image':
    case 'file':
      return evaluateTargetConstructor(expr, state, rootName);
    case 'icon':
      if (expr.args.length !== 1) {
        reportIssue(state, 'icon expects exactly one argument', rootName);
        return unknownPossibilities();
      }
      // Display-only: evaluated for dependency tracking, never a target.
      evaluateInDisplayPosition(expr.args[0], state, rootName);
      return { scalars: new Map(), targets: new Set(), complete: true };
    default:
      reportIssue(state, `unsupported function "${expr.name}"`, rootName);
      return unknownPossibilities();
  }
}

function evaluateIf(expr: Extract<Expr, { type: 'call' }>, state: EvalState, rootName: string): Possibilities {
  if (expr.args.length < 2 || expr.args.length > 3) {
    reportIssue(state, 'if expects two or three arguments', rootName);
    return unknownPossibilities();
  }
  state.displayDepth += 1;
  let condition: Possibilities;
  try { condition = evaluateExpr(expr.args[0], state, rootName); } finally { state.displayDepth -= 1; }
  const evaluateElse = (): Possibilities =>
    expr.args[2] ? evaluateExpr(expr.args[2], state, rootName) : completeScalar('');
  if (condition.complete && condition.scalars.size === 1) {
    const value = condition.scalars.values().next().value as Scalar;
    // Known condition: evaluate only the reachable branch.
    return truthy(value) ? evaluateExpr(expr.args[1], state, rootName) : evaluateElse();
  }
  // Unknown condition: union both branches. When both branches prove finite,
  // the union is complete and no uncertainty is reported.
  const thenBranch = evaluateExpr(expr.args[1], state, rootName);
  const elseBranch = evaluateElse();
  return unionPossibilities(thenBranch, elseBranch);
}

/**
 * Evaluates an expression used only for display. Note-property dependencies
 * are still tracked, but unknown or unsupported display computation never
 * produces issues and never affects the completeness of the owning value.
 */
function evaluateInDisplayPosition(expr: Expr, state: EvalState, rootName: string): void {
  state.displayDepth += 1;
  try {
    evaluateExpr(expr, state, rootName);
  } finally {
    state.displayDepth -= 1;
  }
}

function evaluateTargetConstructor(
  expr: Extract<Expr, { type: 'call' }>,
  state: EvalState,
  rootName: string,
): Possibilities {
  const name = expr.name;
  if (expr.args.length < 1 || expr.args.length > 2) {
    reportIssue(state, `${name} expects a target and an optional display`, rootName);
    return unknownPossibilities();
  }
  const target = evaluateExpr(expr.args[0], state, rootName);
  if (expr.args[1]) {
    // Display position: evaluated for dependencies, ignored for issues.
    evaluateInDisplayPosition(expr.args[1], state, rootName);
  }
  if (target.complete) {
    const targets = new Set<string>();
    if (target.scalars.size === 0) {
      reportIssue(state, `${name} target is not a usable string`, rootName);
      return { scalars: new Map(), targets, complete: true };
    }
    for (const value of target.scalars.values()) {
      if (typeof value === 'string' && value !== '') {
        targets.add(value);
      } else {
        reportIssue(state, `${name} target is not a usable string`, rootName);
      }
    }
    return { scalars: new Map(), targets, complete: true };
  }
  reportIssue(state, `${name} target could not be determined`, rootName);
  return { scalars: new Map(), targets: new Set(target.targets), complete: false };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Analyzes every string formula against every caller-provided row.
 *
 * Rows are the caller's superset (Base filters and YAML are out of scope).
 * When no rows are provided, one empty row is used so constant formulas
 * still produce their constant links.
 */
export function analyzeBaseExpressions(
  formulas: Record<string, unknown>,
  rows: readonly BaseFormulaRow[],
  roots?: readonly string[],
): BaseFormulaAnalysis {
  const formulaNames = Object.keys(formulas)
    .filter((name) => hasOwn(formulas, name) && typeof formulas[name] === 'string' && (!roots || roots.includes(name)))
    .sort();
  const issueMap = new Map<string, BaseFormulaIssue>();
  const dependencies = new Set<string>();
  const links: BaseFormulaLink[] = [];
  const seenLinks = new Set<string>();

  const hasRealRows = rows.length > 0;
  const effectiveRows: readonly BaseFormulaRow[] = hasRealRows
    ? rows
    : [{ path: '', properties: {} }];

  for (const name of formulaNames) {
    for (const row of effectiveRows) {
      const state: EvalState = {
        formulas,
        row,
        memo: new Map(),
        issueMap,
        dependencies,
        hasRealRows,
        displayDepth: 0,
      };
      const result = evaluateFormulaByName(name, state, name);
      for (const target of result.targets) {
        const rowPath = hasRealRows ? row.path : undefined;
        const key = JSON.stringify([name, target, rowPath]);
        if (seenLinks.has(key)) continue;
        seenLinks.add(key);
        const link: BaseFormulaLink = { target, formula: name };
        if (rowPath !== undefined) link.rowPath = rowPath;
        links.push(link);
      }
      if (!result.complete) {
        reportIssue(state, 'formula value could not be fully determined', name);
      }
    }
  }

  return {
    links,
    issues: [...issueMap.values()],
    dependencies: [...dependencies].sort(),
  };
}
