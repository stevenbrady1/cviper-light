/**
 * The built-in sample a new user can check in one click (L-277).
 *
 * A first-time user has to find a CV file AND copy an advert before the app
 * shows them anything. This lets them see what a check gives back first.
 *
 * ============================================================================
 * IT WRITES NOTHING, AND IT IS NOT A CV
 * ============================================================================
 * The sample is never saved as a CV row. There is no way to delete one CV from
 * the app (only "Delete everything"), so a saved sample would sit in the
 * user's CV list for good. Instead this runs the same free keyword scan the
 * "Basic match" option runs, on the two strings below, and hands back a
 * result the screen shows and forgets. No database, no network, no AI.
 *
 * ============================================================================
 * WHY THESE TWO TEXTS
 * ============================================================================
 * A sample is a demonstration, so it has to show what the check is FOR: a
 * believable partial match with real gaps. These land in the middle band
 * ("possible"), match SQL, Python, Excel, Power BI and data analysis, and miss
 * Tableau and Google Analytics. `sample.test.ts` pins that, so a scorer change
 * that turns the sample into a 95 or a "weak" fails the build rather than
 * quietly teaching a new user the wrong thing.
 *
 * The person is invented. No email, no phone number, no real employer.
 */
import { type CvAnalysis } from '@cviper/core-types';
import { atsKeywordScore, scoreByKeywords } from '@cviper/keyword-scoring';

export const SAMPLE_CV_TEXT = `Sam Patel
Data Analyst

PROFILE
Data analyst with four years in retail and logistics, turning messy sales data into weekly reports that managers use to plan stock.

EXPERIENCE
Data Analyst, Northfield Retail Group, Reading (2022 to now)
- Wrote SQL queries against a 40 million row sales database to track weekly margin by store
- Built Excel models and Power BI dashboards used by 60 store managers
- Cut the monthly reporting cycle from five days to two by automating data cleaning in Python
- Ran stakeholder management with buying, finance and operations teams

Reporting Assistant, Swift Freight, Slough (2020 to 2022)
- Produced daily delivery reports in Excel for the operations director
- Checked data quality and fixed errors in the order system

SKILLS
SQL, Excel, Power BI, Python, data analysis, statistics, data cleaning, reporting, stakeholder management

EDUCATION
BSc Economics, University of Reading`;

export const SAMPLE_ADVERT_TEXT = `Senior Data Analyst, Bristol (hybrid), £45,000 to £52,000

We are a growing online retailer looking for a Senior Data Analyst to own our commercial reporting.

What you will do
- Build and maintain dashboards in Tableau for the trading team
- Write SQL and Python to answer questions about customers, pricing and stock
- Run A/B tests on the website and explain the results to non-technical colleagues
- Work closely with stakeholders across trading, marketing and finance

What you will need
- At least 4 years in a data analyst role
- Strong SQL and Excel
- Experience with Tableau or Power BI
- Python for data analysis
- Experience with statistics and A/B testing
- Knowledge of Google Analytics`;

export interface SampleResult {
  readonly analysis: CvAnalysis;
  /** The same 0-100 keyword estimate a real basic-match run carries (L-196). */
  readonly atsKeywordScore: number | undefined;
}

/**
 * Check the sample CV against the sample advert with the free keyword scan.
 * `null` only if the scorer refuses the input, which the tests rule out.
 */
export function runSample(): SampleResult | null {
  const scored = scoreByKeywords(SAMPLE_CV_TEXT, SAMPLE_ADVERT_TEXT);
  if (!scored.ok) return null;
  const ats = atsKeywordScore(SAMPLE_CV_TEXT, SAMPLE_ADVERT_TEXT);
  return { analysis: scored.value, atsKeywordScore: ats.ok ? ats.value : undefined };
}
