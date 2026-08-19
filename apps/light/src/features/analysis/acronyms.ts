/**
 * How a skill or keyword is SPELLED ON SCREEN. Presentation only.
 *
 * ============================================================================
 * WHY THIS LIVES HERE AND NOT IN THE SCORER
 * ============================================================================
 * `@cviper/keyword-scoring` title-cases a skill name with a rule ported from
 * `job_summary` in the Python original, so `sql` renders as `Sql` and `aws` as
 * `Aws`. That rule is FAITHFUL TO ITS SOURCE and `parity.test.ts` pins it
 * there; changing it would break the parity guarantee that makes the port
 * trustworthy, in order to fix something that cannot affect a single score.
 *
 * But it is still wrong on the first thing a new user sees, and the AI path
 * renders `SQL` correctly, so the two providers disagree about the same word on
 * the same screen. The fix belongs exactly here: in the layer that decides what
 * the text looks like, applied to both paths equally.
 *
 * ============================================================================
 * THE RULE THAT KEEPS THIS SAFE: AN EXPLICIT MAP, AND NOTHING ELSE
 * ============================================================================
 * The obvious shortcut — "uppercase any word of three letters or fewer" — turns
 * `Risk` into `RISK`, `Tax` into `TAX` and `Net Revenue` into `NET Revenue`. In
 * London finance recruitment those are not rare words, they are the vocabulary.
 * So there is no heuristic here at all: a term is either in one of the two maps
 * below or it comes out EXACTLY as it went in.
 *
 * Adding an entry is cheap and safe. Adding a rule is not. Do not add a rule.
 */

/**
 * Whole terms whose canonical form is not a word-by-word transformation.
 *
 * Checked first, and keyed on the lower-cased whole term. Two kinds live here:
 *
 *   * terms the scorer never touches at all, because `displaySkill` skips
 *     anything containing a slash or a dot (otherwise `ci/cd` would become
 *     `Ci/Cd`), so they arrive entirely lower-case;
 *   * names with capitals in the middle, which no per-word map can produce.
 */
const PHRASES: ReadonlyMap<string, string> = new Map([
  // Arrive lower-case, because of the slash/dot exemption in the scorer.
  ['ci/cd', 'CI/CD'],
  ['html/css', 'HTML/CSS'],
  ['node.js', 'Node.js'],
  ['vue.js', 'Vue.js'],
  ['next.js', 'Next.js'],
  ['asp.net', 'ASP.NET'],
  ['.net', '.NET'],
  ['c#', 'C#'],
  ['c++', 'C++'],
  ['f#', 'F#'],
  // Internal capitals.
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['github', 'GitHub'],
  ['gitlab', 'GitLab'],
  ['mysql', 'MySQL'],
  ['postgresql', 'PostgreSQL'],
  ['nosql', 'NoSQL'],
  ['mongodb', 'MongoDB'],
  ['dynamodb', 'DynamoDB'],
  ['graphql', 'GraphQL'],
  ['powershell', 'PowerShell'],
  ['power bi', 'Power BI'],
  ['powerbi', 'Power BI'],
  ['ios', 'iOS'],
  ['macos', 'macOS'],
  ['it support', 'IT Support'],
  ['it security', 'IT Security'],
  ['it service management', 'IT Service Management'],
]);

/**
 * Single words that are acronyms wherever they appear.
 *
 * ============================================================================
 * EVERY ENTRY HERE MUST BE A WORD THAT IS NEVER ANYTHING ELSE.
 * ============================================================================
 * `sql` is only ever SQL. `net` is not only ever .NET — it is also net revenue,
 * net margin and net position — so it is NOT here; `.net` is handled as a
 * phrase instead. Same for `it`, which is a pronoun before it is a department,
 * and `js`, which would turn an already-title-cased `Node.Js` into `Node.JS`.
 *
 * When in doubt, leave it out: a term the map does not know renders exactly as
 * the scorer wrote it, which is the behaviour this code replaced and is never
 * worse than it.
 */
const WORDS: ReadonlyMap<string, string> = new Map([
  // Technology
  ['sql', 'SQL'],
  ['aws', 'AWS'],
  ['gcp', 'GCP'],
  ['api', 'API'],
  ['apis', 'APIs'],
  ['ci', 'CI'],
  ['cd', 'CD'],
  ['html', 'HTML'],
  ['css', 'CSS'],
  ['php', 'PHP'],
  ['rest', 'REST'],
  ['restful', 'RESTful'],
  ['soap', 'SOAP'],
  ['saas', 'SaaS'],
  ['paas', 'PaaS'],
  ['iaas', 'IaaS'],
  ['sdk', 'SDK'],
  ['cli', 'CLI'],
  ['json', 'JSON'],
  ['xml', 'XML'],
  ['yaml', 'YAML'],
  ['http', 'HTTP'],
  ['https', 'HTTPS'],
  ['tcp', 'TCP'],
  ['jvm', 'JVM'],
  ['sre', 'SRE'],
  ['devops', 'DevOps'],
  ['etl', 'ETL'],
  ['elt', 'ELT'],
  ['erp', 'ERP'],
  ['crm', 'CRM'],
  ['sap', 'SAP'],
  ['dba', 'DBA'],
  ['ux', 'UX'],
  ['ui', 'UI'],
  ['qa', 'QA'],
  ['seo', 'SEO'],
  ['nlp', 'NLP'],
  // Business, finance and compliance — the app's actual domain.
  ['kpi', 'KPI'],
  ['kpis', 'KPIs'],
  ['sla', 'SLA'],
  ['slas', 'SLAs'],
  ['roi', 'ROI'],
  ['ifrs', 'IFRS'],
  ['gaap', 'GAAP'],
  ['vat', 'VAT'],
  ['hmrc', 'HMRC'],
  ['fca', 'FCA'],
  ['pra', 'PRA'],
  ['aml', 'AML'],
  ['kyc', 'KYC'],
  ['gdpr', 'GDPR'],
  ['mifid', 'MiFID'],
  ['acca', 'ACCA'],
  ['aca', 'ACA'],
  ['cima', 'CIMA'],
  ['cfa', 'CFA'],
  ['frm', 'FRM'],
  ['nhs', 'NHS'],
  ['hr', 'HR'],
  ['sme', 'SME'],
  ['smes', 'SMEs'],
  ['b2b', 'B2B'],
  ['b2c', 'B2C'],
]);

/**
 * A word, for the per-word pass.
 *
 * Starts with a letter, so the leading dot of `.net` is never swallowed — that
 * term is a phrase, and a word pattern that ate the dot would let `net` be
 * matched on its own. `+` and `#` sit inside the run so `c++` and `c#` stay
 * whole rather than being seen as a bare `c`.
 */
const WORD = /[A-Za-z][A-Za-z0-9+#&]*/g;

/**
 * The name to put on screen for one skill or keyword.
 *
 * A term the maps do not recognise is returned EXACTLY as it arrived. That is
 * the safe default, and it is the entire safety property of this module.
 */
export function displayTerm(term: string): string {
  const trimmed = term.trim();
  // Nothing to case. Returned as it came rather than as an empty string,
  // because a blank term is a caller's problem to notice rather than this
  // function's to quietly normalise.
  if (trimmed === '') return term;

  const phrase = PHRASES.get(trimmed.toLowerCase());
  if (phrase !== undefined) return phrase;

  return trimmed.replace(WORD, (word) => WORDS.get(word.toLowerCase()) ?? word);
}

/** `displayTerm` over a list, order preserved. */
export function displayTerms(terms: readonly string[]): string[] {
  return terms.map(displayTerm);
}
