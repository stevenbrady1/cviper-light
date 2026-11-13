import { type ReactNode } from 'react';

import { type TailoredCv } from '@cviper/core-types';

import { cardClasses } from '../../ui';

import { cvHeader, type CvContact } from './cvContact';
import { cvBlocks, type ExportBlock } from './exportBlocks';

export interface CvPageProps {
  readonly cv: TailoredCv;
  /** The details the user confirmed (L-346), or `null`: then no name and no contact line. */
  readonly contact: CvContact | null;
}

/**
 * The tailored CV as a sheet of paper (L-400).
 *
 * It draws the SAME block list the PDF and the Word file are built from
 * (`cvBlocks`), with the name and contact line from the same helper the save
 * code uses (`cvHeader`), so the page shows exactly the sections, order, words
 * and top lines a saved file has. It does not show pages or match the PDF's
 * line breaks. It imports no file builder: the Word code loads on demand.
 */
export function CvPage({ cv, contact }: CvPageProps) {
  const { name, line } = cvHeader(contact);
  const blocks = cvBlocks(cv, name, line);
  const drawn: ReactNode[] = [];
  let bullets: string[] = [];
  let beforeFirstHeading = true;

  const endList = (key: number) => {
    if (bullets.length === 0) return;
    drawn.push(
      <ul key={`list-${String(key)}`} className="mt-2 list-disc space-y-1 pl-5">
        {bullets.map((text, index) => (
          <li key={`${String(index)}:${text}`} data-block="bullet">
            {text}
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  blocks.forEach((block: ExportBlock, index) => {
    if (block.kind === 'bullet') {
      bullets.push(block.text);
      return;
    }
    endList(index);
    const previous = blocks[index - 1];
    if (block.kind === 'name') {
      drawn.push(
        <p key={index} data-block="name" className="text-2xl font-semibold text-ink">
          {block.text}
        </p>,
      );
    } else if (block.kind === 'heading') {
      beforeFirstHeading = false;
      drawn.push(
        <h3
          key={index}
          data-block="heading"
          className="mt-6 border-b border-line pb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase first:mt-0"
        >
          {block.text}
        </h3>,
      );
    } else if (block.kind === 'line' && block.bold === true) {
      drawn.push(
        <p key={index} data-block="line" data-bold="" className="mt-3 font-semibold text-ink">
          {block.text}
        </p>,
      );
    } else {
      // The contact line, and a role's `Company | Location | Dates`, are muted.
      const roleLine = previous?.kind === 'line' && previous.bold === true;
      drawn.push(
        <p
          key={index}
          data-block={block.kind}
          className={beforeFirstHeading || roleLine ? 'text-ink-muted' : 'mt-2'}
        >
          {block.text}
        </p>,
      );
    }
  });
  endList(blocks.length);

  return (
    <article
      data-testid="tailor-cv"
      aria-label="Your tailored CV"
      className={`${cardClasses({ padding: 'none' })} mx-auto w-full max-w-3xl min-w-0 px-5 py-6 break-words text-ink md:px-12 md:py-10`}
    >
      {drawn}
    </article>
  );
}
