/**
 * Two ai-job-search workspaces, as `WorkspaceFiles` (L-167).
 *
 * `PRISTINE` is the framework's own template with `/setup` never run: every
 * value is still a `[PLACEHOLDER]` token, copied verbatim from the sections
 * the importer reads, so the test that "the template imports nothing" is a
 * test against the real shape and not a shape we invented. `FILLED` is the
 * same files as a candidate would leave them after `/setup`.
 */
import { type WorkspaceFiles } from '../../../platform/files';

const PRISTINE_CLAUDE_MD = `# Job Application Assistant for [YOUR_NAME]

<!-- SETUP: This file is populated by running /setup -->
<!-- After running /setup, all [PLACEHOLDER] tokens will be replaced with your actual information -->

## Candidate Profile

<!-- This section is auto-populated by /setup. You can also fill it in manually. -->

### Identity
- **Name:** [YOUR_NAME]
- **Location:** [YOUR_CITY], [YOUR_COUNTRY] ([YOUR_COMMUTE_CONSTRAINTS])
- **Languages:**
  | Language | Level |
  |----------|-------|
  | [LANGUAGE] | [LEVEL] |
  <!-- Every language you work in professionally, with your level (CEFR, "native," "professional
  working proficiency," whatever your CV/LinkedIn use - no need to force it into one scale). -->
- **CV language:** [YOUR_CV_LANGUAGE] <!-- English unless your market expects otherwise; /setup asks -->

- **Status:** [YOUR_EMPLOYMENT_STATUS]
- **LinkedIn headline:** "[YOUR_LINKEDIN_HEADLINE]"

### Education
<!-- List your degrees, most recent first -->
- **[DEGREE_LEVEL] in [FIELD]** ([YEAR_START]-[YEAR_END]) - [INSTITUTION]

### Behavioral Profile
<!-- Your behavioral assessment results (PI, DISC, Myers-Briggs, or self-assessment) -->
- **[TRAIT_1]** - [DESCRIPTION]
- **Strengths:** [YOUR_STRENGTHS]
- **Thrives in:** [YOUR_IDEAL_ENVIRONMENT]

### What Excites You
<!-- What motivates you professionally -->
- [PASSION_1]
- [PASSION_2]

### Target Sectors
<!-- Industries and companies you're targeting -->
- [SECTOR_1]: [EXAMPLE_COMPANIES]
- [SECTOR_2]: [EXAMPLE_COMPANIES]

### Deal-breakers
<!-- Hard constraints on job search. Language requirements are handled separately and
automatically from your Languages table above - don't duplicate them here. -->
- [DEALBREAKER_1]
- [DEALBREAKER_2]

## Repo Structure
- \`cv/\` - LaTeX CV variants (moderncv template, banking style)
`;

const PRISTINE_CANDIDATE_PROFILE = `---
framework_version: 1.1.1
---

# Candidate Profile

<!-- SETUP: This file is populated by running /setup -->

## Identity
- **Name:** [YOUR_NAME]
- **Location:** [YOUR_ADDRESS]
- **Phone:** [YOUR_PHONE]
- **Email:** [YOUR_EMAIL]
- **LinkedIn:** [YOUR_LINKEDIN_URL]
- **GitHub:** [YOUR_GITHUB_URL]
- **Status:** [YOUR_EMPLOYMENT_STATUS]
- **Constraints:** [YOUR_COMMUTE_OR_LOCATION_CONSTRAINTS]

### Languages
<!-- Every language you can work in professionally, with your honest level. -->

| Language | Level | Notes |
|----------|-------|-------|
| [LANGUAGE] | [LEVEL, e.g. "Native" / "C2" / "B1/B2 (conversational)"] | [optional] |

## Education

| Degree | Period | Institution | Key Topics |
|--------|--------|-------------|------------|
| [DEGREE] | [YEARS] | [INSTITUTION] | [TOPICS] |

## References
- [NAME], [TITLE], [COMPANY] ([EMAIL], [PHONE])
`;

const PRISTINE_JOB_EVALUATION = `---
framework_version: 1.2.6
---

# Job Evaluation Framework

### 5. Career Alignment & Motivation (0-100)
Does this role advance career goals and contain tasks that energize?

**Career goals:**
- [YOUR_CAREER_GOAL_1]
- [YOUR_CAREER_GOAL_2]
- [YOUR_CAREER_GOAL_3]

**Motivation filter:** Evaluate not just whether you *can* do the tasks, but whether the tasks will *energize* you. Consider:
- Tasks that energize: [YOUR_ENERGIZING_TASKS]
- Tasks that drain: [YOUR_DRAINING_TASKS]
- Non-task factors: leadership style, department culture, company values, degree of autonomy

**Life situation alignment:** Consider personal constraints:
- **Security**: [YOUR_FINANCIAL_SITUATION_CONTEXT]
`;

const PRISTINE_INTERVIEW_PREP = `---
framework_version: 1.0.0
---

# Interview Preparation Guide

## STAR Format

Structure answers as: **Situation** (context), **Task** (your responsibility), **Action** (what you did), **Result** (outcome).

## Ready-Made STAR Examples

<!-- These are populated by /setup from your actual experience. Below are templates showing the format. -->

### 1. [PROJECT_NAME] ([SKILL_DEMONSTRATED])
**S:** [CONTEXT - what was happening, what was the problem]
**T:** [YOUR RESPONSIBILITY - what you specifically needed to do]
**A:** [WHAT YOU DID - specific actions, tools, methods]
**R:** [OUTCOME - measurable results, adoption, impact]
**Use for:** "[QUESTION_TYPE_1]", "[QUESTION_TYPE_2]"

### 2. [PROJECT_NAME] ([SKILL_DEMONSTRATED])
**S:** [CONTEXT]
**T:** [YOUR RESPONSIBILITY]
**A:** [WHAT YOU DID]
**R:** [OUTCOME]
**Use for:** "[QUESTION_TYPE_1]", "[QUESTION_TYPE_2]"

<!-- Add more STAR examples as needed. Aim for 4-6 covering different competencies. -->

## Common Tough Questions

### "Why did you leave [previous company]?"
> [PREPARE YOUR ANSWER - be honest, forward-looking, no negativity about former employer]
`;

/** The framework as cloned, before `/setup`. Every value is a placeholder. */
export const PRISTINE: WorkspaceFiles = {
  claude_md: PRISTINE_CLAUDE_MD,
  candidate_profile: PRISTINE_CANDIDATE_PROFILE,
  job_evaluation: PRISTINE_JOB_EVALUATION,
  interview_prep: PRISTINE_INTERVIEW_PREP,
};

const FILLED_CLAUDE_MD = `# Job Application Assistant for Jane Example

## Candidate Profile

### Identity
- **Name:** Jane Example
- **Location:** Leeds, UK (hybrid within an hour of Leeds)
- **Languages:**
  | Language | Level |
  |----------|-------|
  | English | Native |
  | French | B2 |
- **CV language:** English

- **Status:** Employed, open to a move; UK citizen, no sponsorship needed
- **LinkedIn headline:** "Credit risk analyst moving into quant development"

### Behavioral Profile
- **Analytical** - reads the numbers before the narrative
- **Thrives in:** small teams with clear ownership

### What Excites You
- Hard technical problems
- Shipping models that people actually use

### Target Sectors
- Banking: HSBC, Lloyds, NatWest
- Hedge funds: Man Group, Marshall Wace

### Deal-breakers
- Fully on-site
- Below GBP 70k
- Relocation outside the UK

## Repo Structure
- \`cv/\` - LaTeX CV variants
`;

const FILLED_CANDIDATE_PROFILE = `---
framework_version: 1.1.1
---

# Candidate Profile

## Identity
- **Name:** Jane Example
- **Location:** 12 Example Street, Leeds
- **Phone:** 07700 900000
- **Email:** jane@example.com
- **LinkedIn:** https://www.linkedin.example/in/jane
- **Status:** Employed, open to a move
- **Constraints:** Hybrid within an hour of Leeds; right to work in the UK, no visa needed

### Languages

| Language | Level | Notes |
|----------|-------|-------|
| English | Native | |
| french | B2 (conversational) | evening classes |
| German | A2 | |

## Education

| Degree | Period | Institution | Key Topics |
|--------|--------|-------------|------------|
| MSc Statistics | 2016-2017 | Example University | Bayesian methods |
`;

const FILLED_JOB_EVALUATION = `# Job Evaluation Framework

### 5. Career Alignment & Motivation (0-100)

**Career goals:**
- Lead a small modelling team within three years
- Move from reporting into model development
- Keep one foot in the code

**Motivation filter:** Evaluate not just whether you *can* do the tasks. Consider:
- Tasks that energize: model building, pairing with engineers, teaching
- Tasks that drain:
  - Status meetings
  - Slide decks for their own sake
- Non-task factors: leadership style, department culture

**Life situation alignment:**
- **Security**: mortgage, so no long gaps
`;

const FILLED_INTERVIEW_PREP = `# Interview Preparation Guide

## Ready-Made STAR Examples

### 1. IFRS 9 model rebuild (Ownership)
**S:** The impairment model failed its annual audit two months before year end.
**T:** Rebuild the model and get it signed off before the reporting deadline.
**A:** Rewrote the staging logic in Python, added a reconciliation suite, walked the auditors through it weekly.
**R:** Signed off three weeks early; the reconciliation suite is still run every month.
**Use for:** "Tell me about a time you owned a problem", "Working under pressure"

### 2. Pricing dashboard (Influence)
**Situation:** Traders were pricing from a spreadsheet nobody trusted.
**Task:** Persuade the desk to move to a shared tool.
**Action:** Built a prototype in a week and sat with the desk for a month of feedback.
**Result:** Adopted by all four desks; the spreadsheet was retired.

### 3. Half-finished example (Curiosity)
**S:** Something happened.
**T:** I had to do something.
**A:** I did it.
**Use for:** "Curiosity"

## Common Tough Questions
`;

/** The same files after `/setup`, with a few rough edges a real one has. */
export const FILLED: WorkspaceFiles = {
  claude_md: FILLED_CLAUDE_MD,
  candidate_profile: FILLED_CANDIDATE_PROFILE,
  job_evaluation: FILLED_JOB_EVALUATION,
  interview_prep: FILLED_INTERVIEW_PREP,
};
