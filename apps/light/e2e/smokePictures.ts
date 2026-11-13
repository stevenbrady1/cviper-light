/**
 * The pictures the smoke job saves of the real app, and what each must show
 * before it is saved (L-244, L-363).
 *
 * The first five are L-244's and keep their names: other things link to them.
 * The last three show a STARTED job (`demoStartedJob.ts`) — the only pictures
 * with the tracker card's progress dots, the step bar and the ATS Score table
 * on them.
 *
 * ============================================================================
 * A PICTURE OF THE WRONG SCREEN FAILS. IT IS NEVER SAVED QUIETLY.
 * ============================================================================
 * L-244's pictures are an artefact for a person, so a step that landed on the
 * wrong screen still saved a PNG and stayed green. For these three that would
 * defeat the point: they exist so a change to the marks shows up in a picture.
 * So each has a check that runs IN THE PAGE, just before the picture is taken,
 * and returns a sentence saying what is wrong — or `''` when the screen shows
 * what the picture is for, wholly inside the window, not cropped away.
 *
 * Plain JavaScript in strings, because WebDriver runs it inside the web view.
 * `src/lib/smoke-pictures.test.tsx` runs the same strings against the real
 * components in jsdom, right and wrong.
 */

/** Every picture the smoke job saves, in the order it saves them. */
export const SMOKE_PICTURES: readonly string[] = [
  '1-tracker',
  '2-tracker-application',
  '3-analysis',
  '4-search',
  '5-settings',
  '6-tracker-card-progress',
  '7-step-bar',
  '8-ats-table',
];

/** Shared by every check: is it on screen, and which marks does it draw. */
const PRELUDE = String.raw`
function onScreen(element, what) {
  const box = element.getBoundingClientRect();
  if (!(box.width > 0 && box.height > 0)) return what + ' takes up no space on screen';
  if (box.top < 0 || box.left < 0 || box.bottom > window.innerHeight || box.right > window.innerWidth) {
    return what + ' is not wholly inside the window (top ' + Math.round(box.top) +
      ', bottom ' + Math.round(box.bottom) + ', left ' + Math.round(box.left) +
      ', right ' + Math.round(box.right) + '; window ' + window.innerWidth + 'x' +
      window.innerHeight + ')';
  }
  return '';
}
function marksIn(element) {
  return Array.prototype.map.call(element.querySelectorAll('[data-mark]'), function (mark) {
    return mark.getAttribute('data-mark');
  });
}
function lacking(element, wanted, what) {
  const seen = marksIn(element);
  const absent = wanted.filter(function (name) { return seen.indexOf(name) === -1; });
  return absent.length === 0
    ? ''
    : what + ' draws no ' + absent.join(', ') + ' mark (it draws: ' + (seen.join(', ') || 'none') + ')';
}
function byTestId(id) {
  return document.querySelector('[data-testid="' + id + '"]');
}
`;

/**
 * `6-tracker-card-progress`: the started job's card, with its progress row
 * under it drawing exactly `arguments[1]` (e.g. dot, dot, dot, ring, ring).
 *
 * arguments[0]: the application id. arguments[1]: the marks, in order.
 */
export const CHECK_CARD_PROGRESS =
  PRELUDE +
  String.raw`
const id = arguments[0];
const expected = arguments[1];
const card = byTestId('tracker-card-' + id);
if (card === null) return 'there is no tracker card ' + id + ' on screen';
const row = byTestId('tracker-card-progress-' + id);
if (row === null) return 'the card ' + id + ' has no progress row under it';
const seen = marksIn(row);
if (seen.join(',') !== expected.join(',')) {
  return 'the progress row draws ' + (seen.join(', ') || 'no marks') + ', not ' + expected.join(', ');
}
return onScreen(card, 'the card') || onScreen(row, 'the progress row');
`;

/**
 * `7-step-bar`: the step bar for the job titled `arguments[0]`, on step
 * `arguments[1]`, drawing a tick, a dot and a ring.
 */
export const CHECK_STEP_BAR =
  PRELUDE +
  String.raw`
const title = arguments[0];
const current = arguments[1];
const bar = byTestId('job-steps');
if (bar === null) return 'there is no step bar on screen';
const job = byTestId('job-steps-job');
if (job === null || job.textContent.indexOf(title) === -1) {
  return 'the step bar is not for ' + title + ' (it says: ' + (job === null ? 'nothing' : job.textContent) + ')';
}
const steps = bar.querySelectorAll('[data-testid^="job-step-"][data-state]');
if (steps.length !== 5) return 'the step bar has ' + steps.length + ' steps, not 5';
const here = byTestId('job-step-' + current);
if (here === null || here.getAttribute('data-state') !== 'current') {
  return 'the step bar is not on ' + current + ' (that step is ' +
    (here === null ? 'missing' : here.getAttribute('data-state')) + ')';
}
return lacking(bar, ['tick', 'dot', 'ring'], 'the step bar') || onScreen(bar, 'the step bar');
`;

/**
 * `8-ats-table`: the ATS Score section, on the ATS Score step, every row there
 * and every mark it can draw — tick, warning, cross, up and down. Since L-396
 * the keyword and bullet rows are bars above the table, so those two rows (and
 * the up and down marks) are looked for anywhere in the section; the three
 * checks must still be in its table. All five rows wholly on screen.
 *
 * arguments[0]: the job's title.
 */
export const CHECK_ATS_TABLE =
  PRELUDE +
  String.raw`
const title = arguments[0];
const job = byTestId('job-steps-job');
if (job === null || job.textContent.indexOf(title) === -1) {
  return 'the screen is not for ' + title + ' (the step bar says: ' + (job === null ? 'nothing' : job.textContent) + ')';
}
const step = byTestId('job-step-ats');
if (step === null || step.getAttribute('data-state') !== 'current') return 'the step bar is not on ATS Score';
const section = byTestId('tailor-ats');
if (section === null) return 'there is no ATS Score section on screen';
const table = section.querySelector('table');
if (table === null) return 'the ATS Score section has no table';
const rows = ['tailor-ats-keyword', 'tailor-ats-bullets', 'tailor-ats-check-section_headers',
  'tailor-ats-check-contact_info', 'tailor-ats-check-cv_length'];
function row(id) { return section.querySelector('[data-testid="' + id + '"]'); }
const absent = rows.filter(function (id) { return row(id) === null; });
if (absent.length > 0) return 'the ATS Score section has no ' + absent.join(', ') + ' row';
const outside = rows.slice(2).filter(function (id) { return !table.contains(row(id)); });
if (outside.length > 0) return 'the ATS table has no ' + outside.join(', ') + ' row';
return lacking(section, ['tick', 'warning', 'cross', 'up', 'down'], 'the ATS Score section') ||
  onScreen(row('tailor-ats-keyword'), 'the keyword row') ||
  onScreen(row('tailor-ats-bullets'), 'the bullet row') ||
  onScreen(table, 'the ATS table');
`;
