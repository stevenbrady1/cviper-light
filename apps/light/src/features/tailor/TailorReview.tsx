import { type DraftReview } from '@cviper/core-types';

import { cardClasses } from '../../ui';

/** What a hiring manager would say about the draft, issue by issue. */
export function TailorReview({ review }: { readonly review: DraftReview }) {
  return (
    <div
      data-testid="tailor-review"
      data-verdict={review.verdict}
      className={`${cardClasses({ padding: 'none' })} px-4 py-3`}
    >
      <p className="font-medium text-ink">
        {review.verdict === 'ready'
          ? 'A hiring manager would call this ready.'
          : 'A hiring manager would send this back.'}
      </p>
      {review.issues.length === 0 ? (
        <p className="mt-1 text-ink-muted">Nothing serious to fix.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {review.issues.map((issue, index) => (
            <li key={`${index}:${issue.section}`} data-testid="tailor-review-issue">
              <span className="font-medium text-ink">{issue.section}</span>
              <span className="block text-ink-muted">{issue.problem}</span>
              <span className="block text-ink">{issue.suggestion}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
