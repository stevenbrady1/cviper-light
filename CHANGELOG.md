# Changelog

All notable changes to CViper Light are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The free check now knows the difference between what an advert needs and what it would like (L-289). Missing a "desirable" or "nice to have" no longer costs as much as missing an essential: it costs nothing, and it is not listed as a skill you are missing. Having one still counts in your favour. It reads "Desirable:", "Nice to have", "It would be great if you have", "Bonus points for" and "Ideally" headings, and lines marked "(desirable)" or "would be an advantage". A score can only go up compared with before, never down. Adverts that mark nothing are scored exactly as before. On the ten test adverts, the teaching assistant's good fit moves from 56 to 64 ("possible"), because GCSE English and Maths is only desirable there; eight pairs are unchanged.

- The free check no longer calls a match "strong" on one or two requirements (L-287). When it can recognise fewer than three things an advert asks for, the score is capped at 74, the top of "possible", and the summary says why: "Only 1 requirement could be recognised in this advert, so the score is capped…". Before, a care advert with one recognised requirement gave a matching CV 92, "strong", on a single phrase. Adverts with three or more recognised requirements score exactly as before, and the cap only ever lowers a score. Job search sorts by these bands, so a thin advert now sorts with the "possible" matches.

- Six everyday English words are no longer read as tech skills unless they are written like one (L-286). "The rest of the round" on a care CV counted as REST APIs, "I go to de-escalation first" as the Go language, and "window displays" as Microsoft Windows; in an advert, "the rest of the team" made REST a requirement every applicant then missed. Now go, rest, react, windows, swift and rust count only when written with a capital (Go, REST, Windows Server) or on a line with another tech skill, such as "python, go, rust". On the twenty test CVs this drops exactly those three false matches and keeps the real "Windows Server". Words like Excel, testing and risk are left alone on purpose, because hiding a skill someone has is worse.

- A higher UK qualification now counts for the lower one it includes (L-285). A CV with NVQ Level 3 meets an advert asking for NVQ Level 2, and a C+E licence meets one asking for a C licence, which you cannot hold C+E without. Only the CV side is widened: an advert asking for Level 3 is not read as also asking for Level 2, and a CV that says "No NVQ Level 3" gets neither.

### Fixed

- Skill names are now spelled the same in the free check's advice as in its lists (L-288). The lists already showed "SQL" and "Power BI", but the advice under them said "The advert asks for Sql" and "Power Bi", because the sentences skipped the step that fixes names for the screen. That step now runs inside the check itself, so every name it writes is right wherever it appears. Joining words also stay small: "Literacy and Numeracy", "End of Life Care". Nothing about any score changes.

- The free CV check no longer counts a skill your CV says you do not have (L-283). "No CPC or tachograph card yet" used to count as holding a tachograph card, and "Driver CPC not held" as holding a CPC. Now a skill right after "no", "not", "without", "lacking", "do not have" or "don't hold", or right before "not held", "expired" or "lapsed", is not counted — unless the CV names it somewhere else as well. The rule is narrow on purpose, because hiding a skill you hold is worse than the old bug: "not only", "no less than", "never", "non-technical", "working towards" and "pending" still count as having it. It changes only which skills are read from the CV; the advert and the ATS keyword check are read as before. On the twenty test CVs it removes exactly one skill — the tachograph card that CV says it lacks.

### Added

- Nice-to-haves you do not show are listed again, but not as gaps (L-292). Since L-289 a missed "desirable" costs nothing and is not in "What they asked for and could not find" — right for the score, but you were no longer told about it. A short list under it now says "Nice to have, not on your CV — these do not lower your score." Basic match only, and only when the advert marks something as desirable.

- A confidence line under every basic-match score (L-291): "Confidence: low — based on only 2 requirements found in the advert. Read the advert yourself before relying on it.", or "Confidence: high — based on 7 requirements found in the advert." A 70 built on two requirements and a 70 built on ten used to look the same. It counts exactly what the score counted, so "low" is exactly when the score is also held below "strong". It describes how much the check had to go on, not how good your fit is, so it is never shown in a warning colour. It is not shown on AI results, whose score does not come from the word list. Low is fewer than 3, medium 3 to 5, high 6 or more; the 6 is a judgement, easy to move.

- Proof behind every match (L-290). Under "What you have", a folded "Show where your CV says this" lists each matched skill next to the line of your CV it came from, so you can check a match instead of taking it on trust. The lines follow the same rules as the score: a line saying you lack a skill ("No SQL at my first job") is never shown as proof, and a skill with no line the check can point to is left out rather than guessed. It works for the sample too, and for AI results wherever the skill's name appears in your CV. Nothing new is saved.

- The free CV check now knows UK qualifications, licences and checks (L-282). It used to find no requirements at all in a care, HGV or teaching assistant advert, so those scores were close to random. A hand-made list of 63 terms — NVQ Level 2 and 3, DBS check, C+E and C licences, Driver CPC, digital tachograph, SIA licence, EYFS, SEMH, EHCP, food hygiene, CSCS-style site cards and more — is now read on both sides, and different wordings of the same thing count as the same thing: a CV saying "Level 2 Diploma in Health and Social Care" meets an advert asking for "NVQ Level 2". On the ten-advert test set the right CV now scores higher in 10 of 10 pairs, up from 6. That set was in view while the list was written, so it shows the list fixes what it aimed at, not that it works on every advert. Words that mean something else in another job are only matched inside a longer phrase, so "CPC" in a marketing advert (cost per click) and "ADR" in a legal one (dispute resolution) are not read as driving qualifications. Tech and finance adverts score exactly as before.

- A test that asks the free CV check the question a user asks (L-281): given a CV that fits the job and one that does not, does the fitting one score higher? Ten real UK adverts (care, charity retail, HGV driving, a school, customer service, treasury, HR, operations, data, security and compliance), requirements paraphrased, with twenty invented CVs, one good and one poor fit each. Today the check gets 6 of the 10 pairs the right way round; the test pins that number exactly, so a change that makes it worse fails CI, and a change that makes it better must say so by raising it. The four it gets wrong — care, HGV, teaching assistant, and a health-and-safety CV tying a real analyst at 92 — are the targets for the next two changes. No app behaviour changes.

### Changed

- The WebKit check in CI no longer depends on a fast Ubuntu mirror (L-284). Its install pulls about 70 system packages, and on 26 October the mirror served them at a few kB/s three times; the L-280 cap stopped the job hanging but still failed it. apt now keeps those packages in a folder CI saves and restores, so a warm run downloads only what Ubuntu has updated since. Tested on Ubuntu 24.04 with a small package: without the change, the image deletes the package after installing it and the next install downloads it again; with it, the next install needs 0 bytes. A contract test fails if the cache, the apt setting or the report step goes missing. No app change.

## [0.11.0] — 2026-10-26

The launch release. The free CV check reads skills it used to miss, a new user sees a full result in one click and is no longer asked for job-board keys, there is a tenth UK job board, and three security fixes: AI requests no longer follow redirects, a local Ollama run never goes through a proxy, and a memory issue in backup validation is patched.

### Added

- A one-click sample on the Analysis screen (L-277). Before you have added a CV, "Try it with a sample CV" checks a made-up data analyst's CV against a made-up advert with the basic match and shows the full result, so a new user sees what a check gives back before hunting for files. It saves nothing — no CV row, no history — because a single CV cannot be deleted from the app, and a sample would otherwise sit in your list for good. It contacts nothing, it is gone once you add your own CV, and "Hide the sample" puts it away. A test pins the sample to a middle-band result with real gaps, so a scorer change cannot quietly turn the demonstration into a 95 or a "weak".

- Every release now also carries the Mac disk image under one name that never changes, `CViper-Light-macOS.dmg`, next to `CViper-Light-Windows-x64.exe` (L-261), so cviper.ai can offer a Mac download button that never needs a version number. A release with no Mac build (the Apple secrets unset) still ships Windows and says so in its summary; a release with two disk images is refused rather than guessed at. The guard that holds the Windows name now holds this one too, and checks that the signing job can never pick either up.
- A tenth keyless job board: GOV.UK Find a job, the Department for Work and Pensions' Work Hub service (L-262). It is UK-wide, covers every sector, searches by keyword and location, and needs no account; like the other nine it opens in your own browser, and the app never loads or reads the page. The search address uses `keywords`, because the `q` the page also accepts is ignored and returns every job in the country.

### Changed

- A slow package mirror can no longer hold the WebKit check for 20 minutes (L-280). Twice on 26 October the browser install ran out the whole job: not a hang, but the Ubuntu mirror serving WebKit's system libraries at 20-40 KB/s, against a normal install of under a minute. Each install attempt is now capped at 5 minutes and a slow one is retried once on a fresh connection. Before the retry, a small script stops the apt-get the cap leaves behind (it runs under sudo, out of `timeout`'s reach, and kept the dpkg lock so the first version of this retry failed in a second) and repairs any half-done install. A contract test holds both caps and the lock release. This shortens the stall and usually recovers it; caching the system packages would remove the download altogether and is not done here.

- Job-board keys are out of the first-run path (L-276). The welcome card for search no longer says "Free keys add more results", and the Search screen no longer shows a row of greyed-out Adzuna and Reed boxes on a machine with no key. A new user sees the free feeds and the board buttons, which need nothing. The keys still work and are still one fold down in Settings under "Job-board keys (optional)"; the moment either key is saved, or half-saved, the row comes back exactly as before, with each board's reason and its Settings link.

- The app starts with about 700 kB less code to load. The libraries that read a Word CV and write a Word export (`mammoth`, `docx`, `jszip`) were in the main bundle and parsed on every launch, though most sessions never touch a Word file; they now load the first time a Word file is read or saved. The main chunk drops from about 1.6 MB to 900 kB. A contract test forbids static imports of either.

- Release and Store builds are harder to tamper with and harder to stall. Every checkout in the release and Store workflows drops the job's GitHub token instead of leaving it in `.git/config`, where any build dependency could have read it and replaced a published installer. The Store package now waits for CI to pass on a commit on `main`, as releases already did, so a package can no longer be built from a red or unmerged commit. Rust is pinned to 1.99.1 in `rust-toolchain.toml` and in every workflow, so the compiler changes only when a PR says so. CI and smoke runs on `main` are no longer cancelled by a burst of merges, which used to leave a tag waiting on a manual re-run: each commit on `main` now gets its own concurrency group, because turning `cancel-in-progress` off still let GitHub cancel a pending run when a third merge arrived. Every job now has its own timeout instead of GitHub's six hours. Four new contract tests hold all of this.

### Fixed

- The free CV check no longer misses a skill that ends a sentence or shares a slash (L-275). "Advanced Excel.", "residents with dementia." and "Python/Django" all hid the skill, because the word matcher treated `.` and `/` as part of the word; the check then told people to add words their CV already had. A full stop now ends a word unless a letter follows it, so `node` still does not match inside `node.js`, and a slash now separates two skills. Hyphens are unchanged on purpose: splitting them would make "go" match "go-to-market". The same matcher feeds the match score, the keyword score, the skills panel, search ranking and the Tailor comparison, so all of them gain the fix. This is a deliberate break from the old web app's scorer, which had the same defect; that app is mothballed, so there is nothing left for the two to disagree about.

- A crash on one screen no longer takes the whole app down. There was one error boundary, round everything, so a render error on Tailor (say) blanked the window, menu included, and "Try again" re-rendered the same broken screen. Each screen now has its own: the menu and the other screens keep working, and moving to another screen starts it clean. The error message is still never shown, since it can carry CV text.

- Keyboard and screen-reader focus now follows you to the new screen. Switching screens dropped focus to the top of the page, so a keyboard user had to tab through the menu to find where they were; the new screen's heading now takes focus (WCAG 2.4.3).

- A local Ollama run no longer goes through a proxy. The app's network client honoured `HTTP_PROXY`/`ALL_PROXY` and the system proxy settings, with no exception for `127.0.0.1`, so on a machine with a proxy set (common on work laptops and with some VPNs) the CV and advert sent to Ollama travelled to that proxy in plain HTTP. Ollama now has its own client that never uses a proxy and never follows a redirect; every cloud provider keeps the proxy, so users who need one can still reach them. A test runs the real request against a fake proxy in a child process and fails if the local request reaches it.

- Screen readers no longer repeat the "model is thinking" message every second. The running seconds counter sat inside the live status line, so each tick changed it and Narrator or NVDA read the whole sentence again. The counter is still shown, but hidden from the accessibility tree, so the message is read once.

- Fetch from a link now refuses private addresses hidden inside IPv6 transition prefixes. On an IPv6-only network with NAT64 (common on work Wi-Fi and phone tethering), an advert whose name resolved to `64:ff9b::c0a8:101` reached the user's router at 192.168.1.1; 6to4 (`2002::/16`) carried the same trick. The IPv4 address inside both is now judged as itself, and local-use NAT64 (`64:ff9b:1::/48`), Teredo (`2001::/32`) and the old site-local range (`fec0::/10`) are refused. The custom AI provider check shares the rule, so it tightens there too.

- Keyboard focus is visible again in Windows High Contrast. The focus ring is drawn with a box-shadow, which High Contrast removes, and the rule beside it said `outline: none`, so a keyboard user there saw no focus at all. The ring now also carries a transparent outline: invisible normally, repainted in the system highlight colour under High Contrast. A contract test holds it.

### Security

- Requests to the cloud AI providers no longer follow redirects. The shared network client followed up to ten, and on the way it stripped only the `Authorization` header, so an Anthropic key (sent as `x-api-key`) would have gone along with a redirect to another host, and a request could have followed https down to http. No provider redirects an API call for a good reason, so a redirect now comes back as an error. Job-board feeds are unchanged.

- "Delete everything" now also removes a half-written safety copy. The copy made before an update is written through a temporary `cviper.db.partial` file; a crash or a full disk mid-copy left that file, a full copy of the CVs and applications, behind.

- zod is updated from 4.4.3 to 4.6.7 for GHSA-mrhx-c7xc-m3w5, where validating an oversized collection could exhaust memory. A backup file is validated with zod on import, so a hostile backup could have frozen the app. The test that proves zod never runs its `new Function` probe read zod's internals, which changed shape in 4.6; it now reads the new shape and still fails loudly if they change again.

## [0.10.6] — 2026-10-20

0.10.5 was tagged but never published: its Mac build was correct, but the release workflow's own extra packing step went red (L-260) and the Windows installer's stable download name was never written. This is the same code with that workflow fix, released properly.

### Fixed

- The release workflow no longer packs a second macOS updater bundle (L-260). tauri-action already tars the signed, notarised `.app` and uploads it, and the `sign` job signs that one; the extra step would have put two bundles on the draft and made the manifest writer refuse both. Its upload failed on light-v0.10.5 instead, which turned the Mac leg red and, because the stable-name job waited on every leg, left the Windows installer without the name cviper.ai's Download button fetches. That job now runs whenever a leg finished, like signing does. Two contract tests hold both.

## [0.10.5] — 2026-10-20

### Added

- macOS. The release workflow's Mac leg has always been there behind the Apple signing gate; this is the first release cut with the five `APPLE_*` secrets set, so it builds, signs and notarises a universal (Intel and Apple Silicon) binary and publishes it alongside the Windows installers. Whether the first run gets all the way through is exactly what this release is for.

- The Store package is now installed and opened on the build machine (L-259). Microsoft's certification kit reads the package but never runs it, so until now the owner had to install each build on a real PC, trusting a throwaway certificate on it, just to see whether a window appeared. The MSIX workflow now does that itself on a throwaway runner: trust, install, launch from the Start-menu path, wait for a window, keep it up, photograph it, uninstall, untrust by thumbprint. It goes red if no window appears, and the artefact carries the verdict and the screenshot. It still cannot click through the app, because the Store build deliberately has no automation hooks; the smoke test covers that on the same code.

### Changed

- The privacy policy no longer names the app version in its first line (L-258). It says it changes only when the list of places the app contacts changes, but the version changed it on every release, with nothing in the policy itself different. The "Last updated" date still says how current it is. A test fails if the version comes back.
- The Windows installer is now built with Tauri's build tool 2.12.2, up from 2.12.1 (#317). Tauri 2.12.2 extends the "no downgrades" check so that a quiet install (passive or update mode) of an older version is stopped with a message, where before only a fully silent one was. CViper Light's copy of the installer template carries that change with the same four CViper changes as before, and the guard that holds the copy to the recorded version is what caught the gap.
- Store: 0.10.4.0 uploaded to Partner Center on 2026-10-20 (Submission 1) and recorded in `store-submissions.json`, so the next package must be above it (L-170).

## [0.10.4] — 2026-10-18

0.10.3 was prepared but never tagged or released, and 0.10.1 and 0.10.2 were tagged but not released, so this release also brings everything listed under 0.10.3, 0.10.2 and 0.10.1 below.

### Added

- Settings → About now links the terms of use, at cviper.ai/terms (L-232). They say in plain words that the app is free and provided as it is, that AI can get things wrong so you should check what it writes before you send it, that nothing in the app is careers, legal or financial advice, and that the laws of England and Wales apply. The link opens in your browser, like the other two.

### Changed

- The privacy policy now says who is responsible and how to reach them privately (L-231). CViper Light is made by Steven Brady, a sole trader in the UK, and privacy questions go to cviperuk@gmail.com instead of only the public issue tracker, where anything you write is visible to everyone. New sections cover the lawful basis for the little we handle ourselves (emails to that address), your rights and how to complain to the ICO, international transfers (a service you choose may be outside the UK), how long things are kept, and our website, naming GitHub Pages and the Cloudflare redirect from cviper.uk. The policy carries a "Last updated" date and says it is for people aged 16 and over, replacing the US "under 13" wording. A test fails if any of these sections goes missing (#240).
- Dependabot now keeps zod on 4.4.x (#308). Zod 4.6 changed the internal that the zod guard reads to prove zod never asks to run generated code, so the guard could no longer tell, and the weekly npm update went red with 29 safe updates stuck behind it. The app's protection itself still works on 4.6; only the check that proves it does not. Patch releases of 4.4 still come through, and a test fails if the hold is removed before the guard is taught to read 4.6.
- The Windows installer is now built with Tauri's build tool 2.12.1, up from 2.11.4 (#310). Tauri 2.12 changed how the installer checks whether CViper Light is still running: it now asks Windows' Restart Manager, which finds the app by its full path. CViper Light's own copy of the installer template (L-253) was still the 2.11 one, so the installer could not be built at all. The copy is now the 2.12.1 template with the same four CViper changes carried across, including the question before an upgrade closes a running app. A test fails if the template's running-app check goes back to the old form.

### Fixed

- With an OpenAI key, the app now uses OpenAI's GPT-6 models (L-248). OpenAI is switching off all four models the OpenAI card offered — `gpt-4o`, `gpt-4o-mini`, `gpt-4.1` and `gpt-4.1-mini` — on 14 January 2027, and names `gpt-6-luna` as the replacement. The card now offers `gpt-6-luna` (the new default), `gpt-6.1-sol` and `gpt-6-astra`. On OpenRouter, the default `openai/gpt-4o-mini` becomes `openai/gpt-6-luna`, and `openai/gpt-4o` becomes `openai/gpt-6.1-sol`. These models refuse a setting ("temperature") the app used to send to OpenAI, so the app no longer sends it to OpenAI, directly or through OpenRouter, and a test fails if it ever does again. If you had chosen one of the old models, the app goes back to that provider's default until you choose again.
- On every Adzuna advert in Search, the word "Adzuna" is now a link to adzuna.co.uk that opens in your browser, as Adzuna's API terms ask (L-239). It used to be a plain label. Reed and Guardian Jobs adverts keep their plain labels: neither asks for more. The privacy policy's line for adzuna.co.uk now names this link too.
- Tracker cards now show the keyboard focus ring (L-235). Tabbing through the tracker, the app's first screen, used to show no sign of where you were: each card's own shadow painted over the ring. The ring now sits where no component style can replace it, and a test fails if it is ever moved back.
- Keyboard focus stays where it should around dialogs (L-236). While "Delete this application?" or "Send this CV to …?" is open, Tab now cycles through its own buttons instead of reaching the page behind it, and when it closes, focus goes back to the button that opened it. On a phone, a card's details cover the whole screen, so they behave the same way: focus moves into them, stays there, and goes back to the card when you close them. On a wider window the details sit beside the board, and Tab can move between the two as before.
- The icon at the top of every screen now matches the sidebar (L-254). The sidebar and phone bar got the new two-colour icons (listed under 0.10.3), but each screen's own header, and the three cards on the welcome page, still drew the old single-colour ones, so Profile, for example, showed two different person icons at once. Headers and welcome cards now use the same drawing as the navigation, from the same table, and a test fails if they ever differ again.

## [0.10.3] — 2026-10-16

0.10.1 and 0.10.2 were both tagged but not released, so this release also brings everything listed under 0.10.2 and 0.10.1 below.

### Added

- Tick several job boards and open them all with one Search (L-219). Under "Search job boards with these filters", each board you have switched on, including ones you added in Settings, now has a checkbox. Tick the ones you want, press Search, and each opens in its own browser tab with your words and filters filled in, alongside CViper's own search. The button says how many boards it will open, your ticks are remembered for next time, and if a board does not open the page says which.

### Changed

- New two-colour icons beside each item in the navigation, on the desktop sidebar and the phone's bottom bar: Profile, Search, Tracker, Analysis, Tailor, and a key for Settings (L-254). The main lines follow the item's text colour; the accent is CViper Light's teal.
- The same style of two-colour icon for the Settings sections: Your data, Job boards, Updates, Getting started, Privacy, About, Report a problem and Delete everything (L-256).

### Fixed

- The Windows setup no longer goes "Not Responding" on its last page (L-253). The desktop shortcut is now made while the app installs, rather than when you press Finish, and "Run CViper Light" starts the app without making the setup window wait for it. The "Create desktop shortcut" box is gone from the last page, because the shortcut has already been made.
- Installing a newer version over an older one by hand no longer opens the old version's uninstaller with its "Delete the application data" box (L-253). The old version is now replaced quietly, keeping your data and saved keys, the same way the in-app update does. If CViper Light is open, the setup asks before closing it.

## [0.10.2] — 2026-10-16

0.10.1 was tagged but not released on its own, so this release also brings everything listed under 0.10.1 below.

### Added

- On the first run of a fresh install, if the app finds API or job-board keys saved by an earlier CViper Light install, the welcome screen names them and asks: Keep them, or Remove them from this computer (L-251). It asks once, only when the app has no data yet, and never deletes anything unless you choose Remove.
- The sidebar shows which version you are running, "CViper Light 0.10.x", just below Settings (L-251).

### Changed

- When no key is saved, each AI key card now says "No key saved" beside its greyed-out "Remove saved key" button, and the "Your own AI service" card says "No service saved", so the button no longer sits there on its own (L-251).
- The Windows setup installer now shows CViper Light's own art: a navy side panel with the logo on its first and last pages, and the logo in the header of the pages between (L-251).

## [0.10.1] — 2026-10-15

### Fixed

- The app no longer estimates what AI costs (L-249). Settings and the Anthropic key card said a typical CV check costs "a few pence"; CViper cannot know what a provider charges, so they now say only what is true: the provider you choose bills your own account at its published rates, prices can change, a model on your own PC is free, and CViper takes no cut. A test fails if a cost estimate comes back.
- Uninstalling on Windows with "Delete the application data" ticked now also removes the API and job-board keys you saved. They are kept in Windows Credential Manager, not in the app's folders, so they used to stay behind. The uninstaller removes only CViper Light's own entries, by their exact names, and leaves them alone when the box is not ticked or when the app is updating. The Microsoft Store version cannot run this step, so there, as on every system, Settings → Delete everything is the way to remove your keys before you uninstall (#281).
- "Remove saved key" on each AI key card now sits next to "Saved ••••", the thing it removes, and looks like a button. It used to sit beside "Test and save this key" in a style that read as plain text. "Remove this service" on the "Your own AI service" card moved the same way, and the job-board cards' "Remove saved key" now looks like a button too (#281).
- With a key already saved, pressing "Test and save this key" on an empty box no longer turns the box red with "Paste your … API key before testing it." Your saved key is fine and still in use, and the card now says so. With no key saved, an empty box is still pointed out as before (#281).

## [0.10.0] — 2026-10-14

### Added

- Upload a CV on Tailor and on Profile, not only on Analysis (L-240). All three use the same reader and save to the same place, so a CV uploaded on one screen is ready on the others. Profile has a new "Your CV" section that names your newest CV. On Tailor the upload works before any AI is set up, so your CV is ready when you are.
- The Windows installer is also published under a name that never changes, `CViper-Light-Windows-x64.exe`, so the Download button on cviper.ai can start the download in one click instead of opening the release page (L-245).

### Changed

- A refreshed welcome screen: "Your job hunt, organised.", three cards — track applications, check your CV, find jobs — each with an example and one button. The CV card says "local AI found" only when the app detects a local model it can use. Screens across the app now share the same headers, section headings, cards and status labels (#270).
- Tailor with no AI set up is no longer a dead end (L-240). It says plainly that tailoring writes new text and so needs an AI, and offers two ways forward: add your own key in Settings, or use a free AI on your own PC.
- Settings now opens by saying what works with no key: the tracker, the basic CV match and job search (L-240). The job-board keys section is called "Job-board keys (optional)" instead of "Advanced".
- When Ollama is running but has no model that can chat, the hint now says what to do in plain words — open the Ollama app and add a chat model in it — with a link to Ollama's download page, which opens in your browser (L-240). It used to give a terminal command. The hint still appears only in that one case. The privacy policy now lists ollama.com as an address opened in your browser.
- Privacy wording says exactly what is and is not sent (L-233). The telemetry switch now says the app "sends no usage data to us" rather than "sends no data", because it does send your CV to an AI you choose when you ask. The upload help says the file is read on this computer and its text only goes to an AI you choose, and only when you ask. The privacy policy no longer promises that we cannot tell whether you use the app: the app itself sends us nothing, but an app store, or GitHub where the update check looks, may show us totals such as download counts. A test now fails if those old phrases come back.

### Fixed

- With an Anthropic key, Claude Opus 5 (the default), Claude Opus 5.5 and Claude Sonnet 5.5 refused every request — CV checks, tailoring, cover letters, everything — because the app sent a setting ("temperature") those models no longer accept. Testing the key in Settings still showed it as working, because that test only lists the models and never asks one a question. The app no longer sends that setting to Anthropic, and a test fails if it ever does again.
- The model lists for xAI Grok and OpenRouter no longer offer models their providers have retired or are about to retire. xAI retired `grok-4` and `grok-4-fast-non-reasoning` in May and now quietly runs `grok-4.3` in their place, at `grok-4.3`'s price; they are replaced by `grok-4.7` and `grok-4.20-non-reasoning`. On OpenRouter, `google/gemini-2.5-flash` stops working on 20 October 2026 and becomes `google/gemini-3.8-flash`, and `anthropic/claude-sonnet-4.5` becomes `anthropic/claude-sonnet-4.6`. If you had chosen one of the old models, the app goes back to that provider's default until you choose again.
- A release is now signed even if one platform's build fails (L-223). For 0.9.0, a failed macOS step left the finished Windows build without the update signature and update file that installed copies need. Signing now covers whatever was built, and still fails loudly if nothing was.

## [0.9.0] — 2026-10-11

The first published release since 0.5.0. Versions 0.6.0, 0.7.0 and 0.8.0 were built but never published, so updating from 0.5.0 brings in everything listed under them as well.

### Added

- A safety copy of your data before an update changes how it is stored (L-227). On the first launch after such an update, before anything is changed, the app copies its database to `cviper.db.before-update` in the same folder. There is only ever one copy, each such update replaces it, the privacy notice lists it, and "Delete everything" removes it with the rest.
- A release is only built from a commit that has passed its checks (L-221). Before the installers are built, the release workflow now waits for the tests, the WebKit check, the secret scan and the real-app smoke test to pass on that exact commit, and refuses a commit that is not on `main`. Before this, a release could be built from a commit whose tests had failed.
- Use any AI service that works like OpenAI's chat API (L-150). Settings → AI provider keys has a new card, "Your own AI service": type its address and key, press "Test and save", then pick a model from the service's own list (or type one). It works for LM Studio or llama.cpp on your own computer, a model server on your network, or a hosted service CViper doesn't list. An address on the internet must start with https://. Tick "This runs on my own computer or network" to use an http:// address and no key, and then the address must really be on your computer or home network. Some addresses are always refused, such as the one cloud servers use for their own secrets. The address and key are tested together and saved together in your computer's credential store, so the key can only ever be sent to that address. Like any provider, it asks before your CV is sent, and "Delete everything" removes it.

### Changed

- The key that signs app updates is no longer visible to the tools that build the app (L-223). The app is now built without it, and a separate step that builds nothing signs the finished installers. Before this, any outside code the build runs could have read the key. The key itself is unchanged, so installed copies keep updating as before.
- Every outside tool the build and release workflows use is now locked to an exact, unchangeable version, and Dependabot proposes updates to them weekly (L-222). Before this, the tool that signs app updates was named by a label its owner could move, so a hijacked label could have put someone else's code next to the signing key.
- iPhone and iPad builds now answer App Store Connect's encryption question themselves (L-173). The app uses only standard HTTPS and Apple's keychain, so the honest answer is "no", and every upload no longer waits on it. A test fails if an encryption library is ever added, which would make that answer untrue.

- Faint side-notes are now smaller as well as lighter, so they read as notes rather than as ordinary text (L-213). The faint and muted greys had to move close together to stay readable, so the colour alone no longer told them apart. This covers the "out of 100" beside a score and empty lines like "Nothing the advert asks for is missing", on Analysis, Profile and interview packs. A test now fails if faint text is added without a size or weight difference.

- CViper no longer keeps where a CV file sits on your computer (its full path, which on Windows names your user account). Nothing ever used it. Paths kept before are cleared when the app updates, and the privacy policy no longer lists them (L-147).

### Fixed

- If part of the app crashes, you now see a "Something went wrong" screen with "Try again" and "Reload the app", instead of an empty window (L-226). It says plainly that your data is safe, because a crash on screen cannot touch what is saved on your computer. The error's details are not shown, so a screenshot of it cannot leak a line of your CV.
- Fetching a job advert from a link can no longer freeze the app (L-225). A page built to be slow to read — the same few characters repeated a few hundred thousand times — used to lock the window for minutes. Each step that reads the page now goes through it once, so even the largest page Fetch accepts (5 MB) is read in well under a second.
- Reading a Word (.docx) CV no longer uses a part with six known high-severity flaws, through which a specially made file could freeze the app or eat memory (L-224). The part is updated, and every change is now checked for known-vulnerable parts before it can be merged.
- The privacy policy (and Settings → Privacy) now lists every small convenience kept in the app's own browser storage: since 0.8.0 that includes which free job feeds you ticked on Search. It never leaves your computer, and "Delete everything" removes it with the rest (L-220).

## [0.8.0] — 2026-10-08

### Added

- The job-board buttons on Search now carry your distance, minimum salary and contract type as well as the job title and location, wherever the site's own link format for it is confirmed (L-219): Reed, Totaljobs and CV-Library take all three; Indeed and LinkedIn take the distance, and LinkedIn "Contract"; Google Jobs takes the contract type. A distance or salary the site does not offer is rounded to the nearest it does — a wider distance, a lower salary — so no job you asked for is hidden. An empty or unreadable filter adds nothing to the link. Your own boards (Settings → Job boards) can use `{radius}`, `{salaryMin}` and `{contract}` too.
- Correct the CV text the AI works from (L-218). On Tailor, "Your CV as the rewrite reads it" now looks read-only (a grey panel, not a text box) and says where the text came from. "Correct the text" opens a real text box: fix anything the app misread from your file, and the correction is kept on the CV, so Analysis, Tailor and every job use it. The panel then says the text was corrected, shows what you changed against the file, and "Restore the text from the file" puts it back (it asks first). A CV the app could read no text from can now be typed or pasted in. Backups carry the correction (still format version 1).
- Every symbol, badge and abbreviation now says what it means (L-215). Hover, tab to, or tap a mark to see a short explanation: the ATS score's ✓ ⚠ ✗, ▲ ▼, the dash, the band words, each row and column, "ATS" itself and the fabrication check; the step bar's ✓ ● ⊘ ○ and the CV/engine line; a tracker card's progress dots; the rail's keyboard shortcuts, service dots and "Requests today"; and the Analysis verdict. Tailor's change list also says what green and struck-through lines mean. Screen readers hear the same words. A test fails if a screen starts showing a symbol without an explanation.

### Changed

- The Search page is laid out around one search (L-219). The blue button always says **Search**. "Search job boards with these filters" now sits directly under the search boxes: the five main boards, the rest under More boards, and each board says (on hover or Tab) which of your filters its link carries. When CViper's own sources find fewer than five jobs, the same boards are offered above the results, one click and one tab each; nothing opens on its own. The job-board keys and the free feeds take one short line each, sorting and today's requests sit with the results, and Arbeitnow (mostly Europe) starts switched off when the location is in the UK, with a note saying so. A tick or untick you make wins, and is remembered. On a phone every source row is a full-size tap target, and the page was checked at 375, 768 and 1280 pixels wide with no sideways scrolling. Settings → Job boards explains the new `{radius}`, `{salaryMin}` and `{contract}` placeholders for your own boards.

### Fixed

- Clicking a step on Tailor's step bar (Tailor, ATS Score, Export, Back, Next) no longer slides the whole window up and leaves the bottom half blank. The step now scrolls only Tailor's own content area; the rail, the page and the window stay put. Tests walk every way of moving — each step link on Tailor and Analysis, each rail item and Ctrl+number shortcut, a tracker card's Continue, and phone width — and fail if anything outside a screen's own area scrolls (L-216).
- Save windows (Save as PDF, Word or text, open a CV, backups) now always open in front of CViper, on the same screen. Before, Windows could put one on another monitor or behind the app, so a save seemed to do nothing. While a save window is open, Tailor now says "Choose where to save it in the save window", instead of showing "Saving…" on the "Save to an application" button (L-217).

## [0.7.0] — 2026-10-08

### Added

- Save the tailored CV and the cover letter as a PDF, beside Word and text (L-201). The PDF is built on this machine with no extra library or font file, keeps the same single-column, ATS-safe layout, and is read back by the app's own PDF reader in the tests. Accented names (é, ł, ñ, ő, ș…) come out exactly; a character the PDF's built-in font cannot show (Cyrillic, Chinese, emoji) is named after the save, with Word as the way to keep it.
- Choose your CV and AI engine once per job: what you pick on Analysis is what Tailor opens with, and the other way round. The step bar shows the choice ("CV: … · Engine: …"). Picking another CV for a job starts its draft again, as it always has on Tailor (L-200).
- Tracker cards for jobs you have started show how far each one has got (●●●○○) and a Continue button that takes you to the next thing to do — Analyse, Tailor or the ATS Score — on the right job (L-200).
- A step bar for each job on Analysis and Tailor: Find → Analyse → Tailor → ATS Score → Export, with Back and Next. It names the job, ticks off what is done, marks a step you went past as skipped (⊘) rather than locking anything, and takes you to any step — including back to the tracker. Moving between steps never runs a check or the AI; you still press the button on the step (L-200).
- Tailor keeps your work for each job. Leave Tailor for another screen and come back, and the tailored CV, the review and the letter are still there; pick another tracked job and it has its own draft, and the first one is waiting when you go back. A draft that finishes after you switched jobs lands on the job it was written for (L-199).
- Your tailoring survives closing the app. Each job's advert, chosen CV and model, and unsaved draft, review and letter are kept on this computer and come back when you reopen it, and "Continue where you left off" takes you back to the job you were on. Nothing is kept for an advert you pasted without a tracked job. "Delete everything" removes all of it (L-199).
- Editing a tracked job's advert on Tailor no longer unlinks the job. The screen says "Advert edited", "Restore the original" puts the job's own text back, and "Save to an application" saves your edited advert beside the CV (L-199).
- Interviewing can be split into your own stages (HR Screen, Technical Test, Panel Round, Final): add, rename, reorder and remove them, and put a card in one. Removing a stage never removes a card. Backups carry the stages (still format version 1). Note: importing a backup written before this release over a card you already have clears that card's stage, because an old file cannot say which stage it was in (L-205).

### Changed

- The keyboard focus ring and the edges of text boxes and drop-downs are now easy to see (L-212). The focus ring was blue at a quarter strength, about 1.5:1 against the page; it is now a crisp white-and-blue ring that measures 3:1 or more on every background, the dark side menu included. Every input, select and text area is edged in a new `field-line` grey at 3.2:1 or more, instead of the faint divider colour (about 1.3:1). The contrast test now checks both, as WCAG 1.4.11 asks.
- Every AI prompt now marks its sections with a random tag made for that prompt alone (`=== JOB ADVERT === #k3f9x2ma`), and tells the model that only a marker ending in that tag opens or closes a section (L-210). A job advert is written before the prompt exists, so it cannot guess the tag: even a fake section marker that got past the text cleaner is read as part of the advert. The cleaner (L-207) still removes marker-shaped lines first; this is a second wall behind it.
- The Store package's version must now be above every version already uploaded to the Store, not just equal to the app version (L-170). Uploads are recorded in `msix/store-submissions.json`; a rollback below the last upload fails `pnpm test`, and packing a version the Store has already been sent stops `msix.yml` before anything is packed.
- "Save to an application" works for a job that has no application yet: it starts one as Saved and saves into it, instead of sending you to the tracker first (L-199).

## [0.6.0] — 2026-09-29

One flow from finding a job to tailoring your CV for it, a tidier Set up
list, and your CV shown on the Tailor screen (L-195).

### Added

- Find a job, check your CV against it and tailor your CV for it, without
  copying anything between screens. "Analyse this job" on a search result saves
  it to your tracker (once — a job already there is reused) and opens it on
  Analysis with the advert filled in. Adzuna, Reed and the Guardian only send a
  preview of each advert, so the app reads the rest from the advert's own page
  when you press the button; if the site blocks apps, Analysis says so and asks
  you to paste the full advert. After a check, "Tailor my CV for this job"
  opens Tailor with the same job, CV and model. A tracker application has
  "Analyse this job" and "Tailor my CV" too, and the check is saved against
  that job (L-190).
- Fetching an advert from its link now reads the job details the page publishes
  for search engines when it has them, so the advert comes in without the menus,
  cookie banners and "similar jobs" around it (L-190).
- The Tailor screen shows the CV you choose right under the picker, as the
  text the rewrite will work from, so you can check it without opening the
  file. It changes as soon as you pick another CV, and "Hide CV" folds it away
  (L-192).

### Changed

- The sidebar's Set up list shows only what is set up. Missing keys and a
  stopped Ollama are no longer listed; a half-entered Adzuna or a key that
  cannot be read still shows, in gold, because it needs you. With nothing set
  up, one line says so and links to Settings (L-191).

## [0.5.0] — 2026-09-29

The CViper logo, a Gemini that finishes its answers, a choice of model per
provider, and fixes to the tracker, the Analysis screen and link fetching
(L-189).

### Added

- The sidebar's Set up list shows which AI providers have a key: each one with
  a saved key by name, gold if its key cannot be read, and one quiet "AI keys"
  dot when there are none (L-182).
- Each AI key card in Settings has a Model list: three to five models for that
  provider, starting with the one the app has always used. The choice is kept
  on this computer and used by everything that provider does in the app —
  analysis, tailoring, pasted adverts, follow-ups and interview packs (L-183).

### Changed

- CViper Light now uses the CViper logo — the navy badge with three teal bars —
  in the sidebar and as its app icon on the taskbar, Start menu, installer and
  Microsoft Store tiles (L-184).

### Fixed

- Google Gemini no longer fails every analysis with "the model ran out of
  room". Thinking models spend part of the answer allowance reasoning, and
  each job's allowance was sized for the answer alone; every cloud provider
  now gets room to think on top of it, so Grok, OpenAI's reasoning models and
  thinking models on OpenRouter are covered too. When a model still runs out,
  the message says the thinking used it up, and it no longer tells you to
  raise an output limit the app does not have (L-185).
- Tracker cards can now be dragged between columns on Windows. Tauri’s own
  file-drop handler was swallowing every in-page drag in WebView2; it is
  switched off, and a file or link dropped on the window is refused rather
  than opened in place of the app (L-186).
- Fetching a LinkedIn job link says what is really happening: LinkedIn blocks
  apps from reading its pages, so the advert has to be pasted as text. It
  used to say only that the page could not be read, which looked like a fault
  in the app. The same message is shown for any site that answers 401, 403 or
  999 (L-188).
- The Analysis screen keeps your CV, the advert, the chosen option and the
  last result when you go to another screen and come back, for as long as the
  app is open. They are held in memory only, never written to disk, and
  Delete everything clears them. A check still running when you leave shows
  its result when you return (L-187).

## [0.4.0] — 2026-09-29

More AI providers, a Settings page that leads with them, and a tracker that is
easier to search and to recover (L-180).

### Added

- The tracker has a search box, and a Retry button when applications fail to
  load, instead of leaving the board empty (#137).
- A pasted advert's salary keeps its period — per year, per day or per hour —
  and is never converted to another unit. A recruitment agency is recorded
  separately from the hiring company, in a new `agency` column that existing
  applications leave empty (#137).
- Four more bring-your-own-key AI providers: Google Gemini, Mistral, xAI Grok
  and OpenRouter, each with its own key card (tested before it is saved), its
  own consent dialog, and its own entry in the generated privacy policy. All
  four speak the OpenAI chat-completions dialect, so one adapter serves them;
  OpenRouter's key is tested against its key endpoint because its model list
  is public (L-177).
- A hand-run Release admin workflow for tidying releases (L-178): set or clear
  a published release's pre-release flag, or delete a draft. It never
  publishes a draft, never deletes a published release or a git tag, and never
  touches the `updater` release.

### Changed

- Settings leads with the AI provider keys. The free Adzuna and Reed keys move
  into an Advanced section that starts closed (L-176).
- The key box hint no longer says every key has a prefix; some providers'
  keys do not (L-177).

### Fixed

- The match score's WEAK / POSSIBLE / STRONG labels no longer print on top of
  each other. The scale had shrunk to the width of "65 out of 100", so every
  result showed the overlap; it now spans the row, the labels are anchored
  apart, and on a narrow window the verdict badge moves below it (L-181).
- Settings → Privacy no longer tells Microsoft Store or phone users the app
  checks for updates at startup. Those builds have no update check; their
  updates come from the store (L-181).

## [0.3.0] — 2026-09-28

The version the Microsoft Store submission and the next download are built
from (L-174).

### Added

- Pasting a job advert asks for AI consent right there (L-141): the paste form
  raises the same consent dialog as the Analysis screen, records the answer in
  the same store, and runs the pending extraction the moment you say yes.
  Decline and nothing is sent, with the paste still in the box. Previously the
  only place consent could be given was the Analysis screen, so a new user's
  first paste with a cloud key was refused and sent on a detour.
- The follow-up and interview panels ask for consent themselves the same way
  (L-171), instead of refusing and pointing at another screen.
- The Store package's version is asserted at pack time (L-169): packing stops
  with a clear message if the staged manifest's version disagrees with the app
  version, rather than shipping a stale one for the Store to reject.

### Changed

- Tracker cards say what the date is for (L-175): the footer reads "Reply by
  Friday · due in 2 days", "Due today" or "1 day overdue", in the same
  urgency colours, instead of a bare `2026-09-29`. The status pill is gone from
  the card, because the column above it already says the status.
- The funnel strip's labels say it counts flow: Applied and Interviewed, not
  Sent and Interviewing, so "Interviewed 2" no longer sits above an
  Interviewing column holding one card as if one of them were wrong.
- The Tailor screen, with no local model or key, has an Open Settings button
  beside the reason instead of only the words.

### Fixed

- The Store package's manifest version had stayed at `0.1.0.0` after the app
  moved to 0.2.0, because nothing tied the two together (L-168). A contract
  test now compares the manifest against the app version on every commit, and
  the manifest readers strip XML comments first, so a commented-out example
  pasted above the real entry can no longer fool every guard at once.
- Opening an application no longer crushes the board: columns keep a minimum
  width and the board scrolls sideways, where titles used to shrink to
  "Senior Pr…" and dates spilled past the edge of the card (L-175).

## [0.2.0] — 2026-09-19

The first published release. An earlier tag, `light-v0.1.0` (2026-09-13),
built installers but its GitHub release was never published — it stayed a
draft, and its contents are folded into this release. `light-v0.2.0` was
tagged 2026-09-15 and published 2026-09-19; the Windows installer it built is
the one the [cviper.ai](https://cviper.ai) download button points at.
Everything below is listed from the "Built" rows of
[docs/FEATURE-MATRIX.md](docs/FEATURE-MATRIX.md), which is the per-feature
source of truth.

### Added

- Application tracker: a board of every application, kept in a local SQLite
  database, with a coloured edge on each card showing how long it has sat
  still.
- CV text extraction from PDF, Word and JSON Resume files, done on your
  machine.
- JSON Resume import of any 1.0 file, and export of the file it arrived as,
  unchanged except for a `meta.cviper` note of when it left.
- Keyword-only CV match against a job advert: no AI, no key, always available.
- CV analysis with a local Ollama model: offline, no key, no network.
- CV analysis with your own AI provider's key, behind a per-provider consent
  dialog that names the provider and says what is sent before the first run.
- Job search inside the app with your own free Adzuna and Reed keys.
- Browse recent jobs with no key: the Arbeitnow and Guardian Jobs feeds, read
  on request and narrowed down on your computer.
- Cross-post detection: the same advert on two boards is flagged, never
  merged.
- Keyless search links to nine UK job boards that open in your own browser;
  Settings lets you turn any off, reorder them and add your own.
- API-key setup: each key is tested before it is saved, stored in the
  operating system's credential store, and can never be read back.
- Paste a job advert and a model fills in the form — title, company,
  location, salary, link and dates; nothing is saved until you have checked
  every field.
- A paste that is only a web link is spotted and moved to the link box rather
  than sent to a model.
- Fetch an advert from a link: one page, on request, with no credentials,
  private and loopback addresses refused.
- Export of all your data as one readable JSON file, and import that merges
  and never deletes.
- Delete everything: the database, every key in the credential store and every
  preference, in one action.
- A privacy notice in Settings generated from the registry of every address
  the app can contact.
- Update check for the direct-download build: once at launch by default,
  switchable off in Settings, plus a button; updates are signed.
- A Microsoft Store flavour of the Windows build with the updater compiled
  out, because the Store replaces the whole package itself.
- Open a CV from the iOS share sheet ("Open in CViper Light" for PDF, Word and
  JSON); built, not yet tested on a device.
- First-run introduction: three cards, reopenable from Settings.
- Candidate profile (L-154): headline, languages with levels, work rights,
  deal-breakers, target sectors, goals, what energises and drains you, a
  writing-style note and STAR examples; the first view, on Ctrl+1; carried in
  the backup file.
- Documents archived on an application (L-155): the advert, the CV and cover
  letter you sent, follow-up notes and interview packs, in the backup file.
- Every system prompt now states that the advert and the CV are material to
  analyse, never instructions to follow (L-153); a contract test derives every
  prompt builder and fails the build if one lacks the clause.
- Eligibility and language gates (L-156): citizenship, residency, clearance
  and language requirements are checked before the score, quoting the advert
  line, as pass, flag or hard stop; they never move the number.
- Search results ranked against your newest CV with no key (L-157), a
  best-match-first toggle, and deal-breaker chips from the profile.
- Skills-gap heatmap on the Profile view (L-158): the skills the adverts on
  your board ask for that your CV does not mention, ranked by how many want
  them.
- A funnel strip on the tracker (L-159): sent, interviewing, offers, rejected,
  with interview and offer rates.
- Follow-up and thank-you drafts from the tracker (L-162): offered after ten
  quiet days, at most twice per application, written only from the materials
  you sent; drafts only — the app never sends anything.
- An interview prep pack from the archived application (L-163): likely
  questions with STAR-shaped answers, talking points, questions to ask, and
  gaps to bridge honestly; saved as a document.
- Tailor a CV to an advert (L-160): a structured rewrite that may use only
  what the CV already says, a second-context reviewer that lists issues and
  never rewrites, a deterministic fabrication check (new metrics, employers,
  years or certifications absent from the original), a line diff against the
  original, saving to the application, and export as plain text.
- A cover letter from the tailored CV and the advert (L-161), with a word
  count and a note over 400 words; saved and exportable.
- Import a candidate profile from an ai-job-search folder (L-167): pick the
  folder, four Markdown files are read by name on this computer, and what was
  found is reviewed before it is added; lists are unioned and typed text is
  never overwritten. No name, contact details or work history are read.

- Save the tailored CV and the cover letter as a Word document (L-165), built
  on your machine and sent nowhere: a single column, the standard headings,
  one plain font, no tables and no images, so a parser reads it the way you
  do.

### Fixed

- Settings said the backup held jobs, applications, CVs and checks, and counted
  only those, while the file had carried the profile and the archived documents
  since L-154 and L-155 (L-166). The "Your data" paragraph, the export message,
  the import preview and the delete confirmation now name them: "2 jobs, 1 CV,
  3 archived documents and your profile".

[Unreleased]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.11.0...main
[0.11.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.10.6...light-v0.11.0
[0.10.6]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.10.5...light-v0.10.6
[0.10.5]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.10.4...light-v0.10.5
[0.10.4]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.10.2...light-v0.10.4
[0.10.3]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.10.2...light-v0.10.4
[0.10.2]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.10.1...light-v0.10.2
[0.10.1]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.10.0...light-v0.10.1
[0.10.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.9.0...light-v0.10.0
[0.9.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.8.0...light-v0.9.0
[0.8.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.7.0...light-v0.8.0
[0.7.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.6.0...light-v0.7.0
[0.6.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.5.0...light-v0.6.0
[0.5.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.4.0...light-v0.5.0
[0.4.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.3.0...light-v0.4.0
[0.3.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.2.0...light-v0.3.0
[0.2.0]: https://github.com/stevenbrady1/cviper-light/releases/tag/light-v0.2.0
