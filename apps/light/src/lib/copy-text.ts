/**
 * The words a user can read in a source file, for copy guards.
 *
 * The same reading `privacy-promise.contract.test.ts` does (that file keeps
 * its own copy, with the suppression hatch it needs on top): for `.ts`/`.tsx`
 * only string literals and JSX text, gathered off the parse tree, so COMMENTS
 * ARE EXCLUDED BY CONSTRUCTION. A `+` chain of strings and a JSX element's
 * children are joined into one piece, so a sentence split across lines or
 * across `{' '}` is still one sentence. `className`, `data-*` and friends are
 * not prose and are skipped. Markdown is read as prose blocks with fenced code
 * and HTML comments blanked out.
 *
 * Whitespace inside a piece is collapsed to single spaces, so a guard matching
 * "a few pence" matches it however the line was wrapped.
 */
import ts from 'typescript';

export interface CopyPiece {
  /** The text, whitespace collapsed. Interpolations read as `HOLE`. */
  readonly text: string;
  /** 1-based line where the piece starts. */
  readonly line: number;
}

/**
 * Stands in for an interpolation or a non-literal operand, so a claim can
 * never be assembled ACROSS something the user would not read as one sentence.
 */
export const HOLE = '￼';

/** JSX attributes that are never prose. A forbid-list, so a new attribute is copy by default. */
const NOT_PROSE = /^(?:className|class|style|id|key|role|type|href|src|htmlFor|xmlns|d)$|^data-/;

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isModuleSpecifier(node: ts.Node): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isImportTypeNode(parent) ||
    ts.isExternalModuleReference(parent)
  );
}

function isSkippedAttribute(node: ts.Node): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  const attribute = ts.isJsxExpression(parent) ? parent.parent : parent;
  if (attribute === undefined || !ts.isJsxAttribute(attribute)) return false;
  return NOT_PROSE.test(attribute.name.getText());
}

function isStringish(node: ts.Node): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isTemplateExpression(node)) return true;
  if (ts.isParenthesizedExpression(node)) return isStringish(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isStringish(node.left) || isStringish(node.right);
  }
  return false;
}

function typescriptCopy(source: string, file: string): CopyPiece[] {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const pieces: CopyPiece[] = [];
  const lineOf = (pos: number): number => parsed.getLineAndCharacterOfPosition(pos).line + 1;

  const collect = (node: ts.Node, parts: string[], rest: ts.Node[]): void => {
    if (ts.isParenthesizedExpression(node)) {
      collect(node.expression, parts, rest);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      parts.push(node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      parts.push(node.head.text);
      for (const span of node.templateSpans) {
        parts.push(HOLE + span.literal.text);
        rest.push(span.expression);
      }
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      collect(node.left, parts, rest);
      collect(node.right, parts, rest);
      return;
    }
    parts.push(HOLE);
    rest.push(node);
  };

  const emit = (parts: readonly string[], at: number): void => {
    const text = tidy(parts.join(''));
    if (text.replaceAll(HOLE, '').trim().length > 0) pieces.push({ text, line: lineOf(at) });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const parts: string[] = [];
      const rest: ts.Node[] = [];
      for (const child of node.children) {
        if (ts.isJsxText(child)) {
          parts.push(source.slice(child.pos, child.end));
          continue;
        }
        if (
          ts.isJsxExpression(child) &&
          child.expression !== undefined &&
          isStringish(child.expression)
        ) {
          collect(child.expression, parts, rest);
          continue;
        }
        parts.push(HOLE);
        rest.push(child);
      }
      emit(parts, node.getStart(parsed));
      if (ts.isJsxElement(node)) visit(node.openingElement);
      for (const child of rest) visit(child);
      return;
    }

    if (isStringish(node) && !isModuleSpecifier(node) && !isSkippedAttribute(node)) {
      const parts: string[] = [];
      const rest: ts.Node[] = [];
      collect(node, parts, rest);
      emit(parts, node.getStart(parsed));
      for (const child of rest) visit(child);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return pieces;
}

function markdownCopy(source: string): CopyPiece[] {
  const blank = (match: string): string => match.replace(/[^\n]/g, ' ');
  const text = source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/^```[\s\S]*?^```/gm, blank)
    .replace(/[*_`~]/g, ' ');

  const pieces: CopyPiece[] = [];
  let block: string[] = [];
  let blockLine = 1;
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') {
      if (block.length > 0) pieces.push({ text: tidy(block.join(' ')), line: blockLine });
      block = [];
      return;
    }
    if (block.length === 0) blockLine = index + 1;
    block.push(line);
  });
  if (block.length > 0) pieces.push({ text: tidy(block.join(' ')), line: blockLine });
  return pieces;
}

/** Every piece of user-readable copy in one source, by file type. */
export function copyText(source: string, file: string): CopyPiece[] {
  if (file.endsWith('.md')) return markdownCopy(source);
  return typescriptCopy(source, file);
}
