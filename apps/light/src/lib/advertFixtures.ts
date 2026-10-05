/**
 * Shared test data for the advert-boilerplate guards (L-208). Not a test file.
 */
export const COOKIE_BANNER =
  'We use cookies to improve your experience on this site. Accept all cookies or manage your cookie settings.';

export const EO_FOOTER =
  'We are an equal opportunities employer and welcome applications from all suitable candidates regardless of age, gender, race, religion, disability or sexual orientation. We are committed to a diverse and inclusive workplace.';

const HEADER = 'Senior Credit Risk Analyst\nBarclays - London, Canary Wharf\n£75,000 - £90,000';

const REAL_BODY = [
  'About the role\nYou will own the quarterly IFRS 9 impairment model for the UK corporate book and present results to the CRO.',
  'Requirements\n- Five years of credit risk experience in a UK bank\n- Strong SQL and Python\n- Basel III and stress testing knowledge',
  'Benefits\n25 days holiday, discretionary bonus, private medical cover and a pension at 10 percent.',
].join('\n\n');

/** An advert with nothing to strip. */
export const ADVERT_BODY = `${HEADER}\n\n${REAL_BODY}`;

/** The same advert wrapped in a cookie banner and an equal-opportunities footer. */
export const ADVERT_WITH_BOILERPLATE = `${COOKIE_BANNER}\n\n${HEADER}\n\n${REAL_BODY}\n\n${EO_FOOTER}`;
