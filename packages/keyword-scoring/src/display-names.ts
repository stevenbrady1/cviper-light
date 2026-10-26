/**
 * How a skill or keyword is SPELLED ON SCREEN. Presentation only.
 *
 * ============================================================================
 * WHY THIS LIVES IN THE SCORER NOW (L-288)
 * ============================================================================
 * `displaySkill` in `score.ts` title-cases a skill name with a rule ported from
 * `job_summary` in the Python original, so `sql` comes out as `Sql` and `aws`
 * as `Aws`. This map used to live in the app (`features/analysis/acronyms.ts`)
 * and fix those names on the way to the screen. It fixed the LISTS. It never
 * reached the SENTENCES the scorer writes itself, so the same screen read
 * "SQL" in the gap list and "The advert asks for Sql" in the suggestion below.
 *
 * So the map moved here and `displaySkill` applies it, once, at the source:
 * every name the scorer emits, in a list or a sentence, is already right. The
 * app re-exports it from its old path and still runs it over the AI path's
 * names, which no scorer touched. It is idempotent, so a second pass over a
 * name that is already right changes nothing (`display-names.test.ts`).
 *
 * The web app this was ported from is mothballed (Sept 2026), and no parity
 * test pins display strings, so this changes no score and no parity case.
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
  // L-288. Joining words, which the ported title-case rule capitalises:
  // "Literacy And Numeracy", "End Of Life Care". Only these two: "to" would
  // turn "To-Be" into "to-Be", and no skill name starts with either.
  ['and', 'and'],
  ['of', 'of'],
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
