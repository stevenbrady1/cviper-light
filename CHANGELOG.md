# Changelog

All notable changes to CViper Light are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Changes waiting for the next release are in [`changes/unreleased/`](changes/unreleased/), one file per change, so two pull requests never edit the same lines here (L-303). `pnpm changelog:preview` shows them as they will appear; `pnpm changelog:release <version> <date>` writes them in below. See [CONTRIBUTING.md](CONTRIBUTING.md#the-changelog).

## [0.17.0] — 2026-11-25

Clearer buttons. Buttons that are just words, like Show CV, Upload a CV, Save this search and Rename, are now blue, so it is clear you can press them, and Delete is red. Behind the scenes, some button settings that never took effect were removed.

### Changed

- Tidied buttons and links behind the scenes: some carried colour and spacing settings that never took effect, and a new check now stops that happening again. Nothing looks different (L-459).
- Buttons that are just words, like Show CV, Upload a CV, Save this search and Rename, are now blue, so it is clear you can press them; Delete is red (L-458).

## [0.16.0] — 2026-11-25

Calmer labels. The small headings and labels in Analysis, Tailor, the interview panel, the new-application form and search results now use normal letters in the app's main font, instead of small spaced capitals. Numbers and dates keep their fixed-width digits.

### Changed

- Small headings and labels now use normal letters in the app's main font instead of small spaced capitals: the result headings in Analysis, the match scale's Weak, Possible and Strong, the ATS score heading in Tailor, the interview panel, the "From the advert" label in the new-application form, and the board name on search results (L-456). Numbers and dates keep their fixed-width digits.

## [0.15.0] — 2026-11-23

A calmer frame for the whole app. On a computer, every screen now sits on one white panel inside the navy frame, and the side menu's footer is quieter: the version line is gone from it (Settings → About still shows your version), the "Set up" heading is now only read out by screen readers, and ready items lose their "i" mark while items that need you keep theirs.

### Changed

- On a computer, every screen now sits in one white panel with round corners inside the navy frame, instead of on a grey page. On a phone the screen is white, edge to edge, with the bar along the bottom as before (L-454).
- The menu's footer is quieter: the "Set up" heading is no longer shown (screen readers still hear it), and a green "ready" dot no longer has its own "i" button. Its explanation still opens when you point at it or tap it. "Requests today" and any amber dot that needs you keep their "i" (L-453).
- The side menu no longer shows the version line at the bottom. Settings → About still says which version you are on, and so does Settings → Updates (L-452).

## [0.14.1] — 2026-11-23

A small fix release for Windows. The installer now moves straight on to its Finish page when it is done, and shows its progress while it removes an older version. This version also carries everything listed under 0.14.0, which was never published.

### Fixed

- The Windows installer now moves straight on to its Finish page when it is done, instead of stopping on an "Installation Complete" page with no button to press. When it removes an older version during an upgrade, it shows that step's progress instead of leaving the screen empty (L-449).

## [0.14.0] — 2026-11-20

Tagged but never published, because the Windows installer fix merged after it. Everything here ships in 0.14.1.

A quieter, cleaner look across the app. Titles stand on their own without the grey icon tiles, labels are in the app's normal font, scroll bars are slim, empty screens share one simple "nothing here yet" look, and Search's buttons sit in one row. Analysis and Tailor now open on one line of choices, "Check [your CV] using [how to check it]" and "Rewrite [your CV] using [your AI]", above a big job advert box with the main button in the bar at its bottom, and "Past checks" moved up next to the Analysis title.

### Changed

- Tailor no longer leaves an empty gap above the job advert box when your CV text is folded. Analysis, Tailor and the empty Tracker board now show their "nothing here yet" message the same way as Search: a small grey icon, the same words and buttons as before, and no dashed box (L-447).
- Analysis reads as one line: "Check [your CV] … using [how to check it]", with a quiet "Upload a CV" at the end. Under it, the job advert box is the biggest thing on the screen, with "Or use one you are already tracking" and "Check this CV" (and why it is greyed out) in the bar at the bottom of the box. "Save as JSON Resume" moved into the "…" beside your CV, still greyed out with its reason for a PDF or Word CV. The AI's note and the line about how your CV file is read now sit in small grey text under the box, word for word as before (L-446).
- Tailor now opens on one line of choices — "Rewrite [your CV] using [your AI]", with Show CV and Upload a CV at its end — above a big advert box. The box's bar holds the tracked-job choice on the left and "Tailor CV", with its reason, on the right; the quieter notes (what the AI means for your CV, what you have agreed to) sit under the box. Each CV in the list shows its word count, and the separate summary line under the picker is gone (L-445).
- "Past checks" on Analysis moved from beside "Check this CV" to the top of the screen, next to the "Analysis" title, as a white button. On a phone it sits under the title. It is greyed out while no CV is chosen or the list is open, as before (L-444).
- The sentence Analysis and Tailor show while the AI works now comes from one place, so the two screens cannot drift apart on what is sent where. Nothing on screen changes (L-443).
- An empty Tracker column now says, in one small line, what goes there, such as "Move a job here once you apply." The lines step aside while you search the board, and a card's "days since last change" now wraps onto a second line instead of being cut short (L-441).
- Section headings in Settings, Job boards and the API-keys card now stand on their own, without the small icon tile beside them, and the list under "AI provider keys" lines up with the text. "Delete everything" keeps its red button and its warning (L-440).
- Pointing at a side-menu item shows its keyboard shortcut to the right of the menu, level with the item, instead of over the next item (L-439).
- On the Tracker, a started job's "Step 3 of 5 · Continue" row now sits inside its card, under a thin line, instead of hanging below it. A selected card now shows its blue edge all round, row included (before, only the age edge showed), and a moved card arrives whole. "Interview stages" now ends the Interviewing column's head with a thin line. Cards with no steps look as before (L-438).
- On Search, every box is now the same height, "Contract type" included, and Within, Minimum salary and Contract type share their row in equal widths. "Where to look" shows a small drawn arrow that turns when it opens, instead of the browser's own mark (L-437).
- Profile shows each saved CV as one row: the name, its word count and date in small grey text, and Rename and Delete on the right, with a thin line between rows. On a phone the buttons sit under the name (L-436).
- Scroll bars are now slim and rounded, with no arrow buttons, and turn a little darker when you point at them. They are still wide enough to grab (L-435).
- Before a search, the results area now shows a small grey search icon over the same words, with no dashed box round it (L-434).
- Search's buttons now sit in one row: Search, "Also open in N boards", then "Save this search" and "Found one? Bring it in" as quiet buttons. If a button is greyed out, the reason is on one line just under the row, and it stays on screen on short windows (L-433).
- Labels read as plain words in the app's own font, not small spaced-out capitals: the Tracker's column heads and stats labels, the side menu's "Ctrl 1" hints and the menu footer's "Set up" (L-432). Numbers and dates keep their fixed-width digits.
- Every screen's title now stands on its own, larger, without the grey icon tile beside it. The menu already shows that icon, and the header is no taller (L-431).
- CViper Light now runs on Tauri 2.12.5, with updated file-dialog, settings, link-opening and update plugins (L-429). The database library stays on sqlx 0.8: the database plugin is still built on 0.8, and the app's only route to the database (L-243) runs on that plugin's own connection, so both must match. Dependabot no longer proposes sqlx 0.9 until the plugin moves, and a test fails if that hold is removed early. No change to your data.

### Fixed

- Screen readers now hear the same due-date words a Tracker card shows, such as "2 days overdue" instead of "overdue by 2 days", and "due tomorrow" instead of "due in 1 day". Nothing on screen changes (L-430).

## [0.13.1] — 2026-11-19

A small fix release for Windows. The uninstaller now shows the CViper icon, and the message you see when CViper Light is still open now says plainly what OK does. This version also carries everything listed under 0.13.0, which was never published.

### Fixed

- Windows: the uninstaller now shows the CViper icon, not the plain default one. When CViper Light is still open during an install or uninstall, the message now says what OK does: "CViper Light is still open. Click OK to close it now (anything not saved will be lost), or Cancel to stop." It used to say "Click OK to kill it" (L-426).

## [0.13.0] — 2026-11-18

Tagged but never published. Everything here ships in 0.13.1.

The biggest change is that CViper Light no longer assumes you are in the United Kingdom. Search has a "Country" picker with the 19 countries Adzuna covers and "Another country"; if you already use the app it stays on United Kingdom and your searches are as before, and a new install is asked to choose before its first search. The distance is in kilometres outside the United Kingdom and the United States, Adzuna's salaries are shown in the chosen country's currency, the job boards you can open in your browser follow the country, and the app's own words, and the instructions it sends to an AI with a pasted advert, no longer assume the UK; Reed lists UK jobs only, so it stays a United Kingdom board. The screens have been reworked too: the menu is in a new order (Tracker, Search, Analysis, Tailor, then Profile and Settings) and the Ctrl+1 to Ctrl+5 shortcuts moved with it, Profile starts with a checklist and lets you rename or delete a saved CV, a job's status on the Tracker is five choices side by side, Settings gains "On this PC" and "What I have agreed to", and titles and scores are in the same typeface as the rest of the app. On Tailor the tailored CV is shown as a page and a saved CV has your name and contact details at the top, and an advert you checked on Analysis can be saved straight to the tracker. Two fixes worth knowing: an Adzuna search "within 25 miles" now looks 25 miles out, and "Withdraw" now appears for every AI provider you agreed to send your CV to. 0.12.0 was prepared but never tagged or released, and 0.11.0 was tagged but never published, so this release also brings everything listed under 0.12.0 and 0.11.0 below.

### Added

- Search has a "Country" picker: the 19 countries Adzuna covers, and "Another country". If you already use CViper Light it is set to United Kingdom and your searches are exactly as before. On a new install, Search asks you to choose a country before your first search, and sends nothing until you do; the app does not guess from your computer. Adzuna then searches the country you chose and shows salaries in that country's currency, and a saved search remembers the country it was saved for. Reed lists UK jobs only, so outside the United Kingdom its tick box is greyed out and says so. The country is kept on your computer with your other Search preferences, and "Delete everything" clears it (L-417).
- The Profile screen starts with a checklist (L-413): how many of its six parts are filled in, a mark for each, what is next, and a "Fill it in" button that takes you to the first part with nothing in it. A part counts as soon as you have started it, and the count keeps up as you type, upload, rename or delete. Nothing new is saved for it.
- Settings has a new part, "What I have agreed to". It lists each AI provider you agreed to send your CV to, with a Withdraw button for each one, and says "Nothing yet" when there are none. Until now you could only see or take back an agreement on Analysis and Tailor (L-410).
- Each saved CV on the Profile screen has "Rename" and "Delete" (L-408). Delete asks first and says what goes with the CV: the saved checks made with it are deleted too; your jobs, and the tailored CVs and letters you saved to a job, stay. If a CV you had picked on Analysis is deleted, Analysis starts on the newest CV that is left.
- Settings now has an "On this PC" box above the AI provider keys. It says whether an AI on your own computer (Ollama) is ready, using the same live check and the same words as the welcome screen. If Ollama is running without a model that can chat, it says so and links to Ollama’s download page. If no AI is found, the box stays and says the basic CV match works without one, with the same link (L-406).
- The Profile screen lists every saved CV, newest first, with how many words it has and the day it was added, for example "540 words. Added 3 November 2026." (L-403). A CV whose text could not be read shows the date alone.
- The test that drives the real, built Windows app now also photographs a job that has been started (L-363): its tracker card with the progress dots, its step bar, and its ATS Score table with a tick, a warning, a cross, a rise and a fall. Each screen is checked before its picture is saved, so a picture of the wrong screen fails the run instead of being kept. The made-up job is analysed and tailored from stored results, with no AI call and nothing sent anywhere, and is deleted again afterwards. The five earlier pictures are taken first and do not change. Nothing in the app changes.
- A CV saved from Tailor as text, Word or PDF now has your name, email and phone at the top (L-346). The first time you save, CViper shows what it read from the CV you uploaded so you can check or change it, and remembers your answer for that job and CV. Nothing is sent anywhere, and a field you leave empty stays off the CV.
- After checking a pasted advert on Analysis, "Save this job to the tracker" puts it on the tracker under Saved (L-325). You type the job title and company; the advert you pasted is saved with it, and the check is filed against the new job, so the job's steps appear and Tailor picks up the same advert, CV and engine. If you already track that exact advert, "Use that job" links the check to it instead of adding a second card. Nothing is sent anywhere.
- Search has a way back in for a job you found on a job board in your browser. Under "Also open", a new button, "Found one? Bring it in", takes you to the Tracker with "Paste a job" already open and the cursor in "Link to the advert" (L-324). It runs no search and is always there, even with no board ticked. The next time you open the Tracker it opens as usual.

### Changed

- Three more places no longer assume you are in the United Kingdom. The Find jobs example on the welcome reads "Data analyst · Remote", not a town in England. The Adzuna key text no longer says its results appear alongside Reed's, because Reed lists UK jobs only; it says "Results are marked with where they came from." When you add an application and there is no currency to suggest (you chose "Another country", or have not chosen one yet), the Currency box's example is USD, not GBP. A United Kingdom search still shows GBP, and every other listed country its own currency (L-424).
- The app's own words no longer assume you are in the United Kingdom. The welcome cards say "Search jobs in one place." and "Search job boards. Save the good ones straight to your board." The Adzuna key text says it gathers adverts in 19 countries. The examples on Profile no longer mention UK citizenship, British spelling or GBP. The help for adding your own job board no longer says the salary is in pounds. Settings → About no longer says where Light was made. Large numbers (the CV length note and the CV text counter) are written in your computer's own format. Lines that are true only of Reed still say UK, and only show for a United Kingdom search (L-423).
- The job boards you can open in your browser now follow the country you search in. The United Kingdom keeps exactly its nine boards, in the same order, with your own choices untouched. Every other country gets LinkedIn and that country's Indeed, plus Adzuna's own site and Google Jobs where that country's address was checked in a real browser and showed that country's jobs. Settings → Job boards says which country's boards are shown. A board you added yourself is offered in every country, and switching a board off for one country does not switch it off for another. The privacy page lists each new site the app may open in your browser (L-422).
- Search's distance box now follows the country: "Within (miles)" for the United Kingdom and the United States, "Within (km)" for every other country. Adzuna is always asked in kilometres and Reed in miles, whichever you typed, and a job board opened from "Also open" gets the distance in its own unit. A United Kingdom search sends exactly the distances it sent before, and a saved search keeps the unit of the country it was saved for (L-421).
- When you paste a job advert, the instructions CViper sends to the AI no longer say the advert is a UK one, or mention London. They now read the same for any country, and a euro and a dollar example sit beside the pound ones. Every pound rule is unchanged (L-420).
- Search no longer guesses whether you are searching the UK from the place you type. The "Country" picker says which country it is. For a United Kingdom search with a place typed, the free feed (Arbeitnow, which is mostly Germany and the rest of Europe) starts unticked, as before; with no place typed, and for every other country, it starts ticked. One thing changes for a United Kingdom search: a place outside the UK, such as "Berlin", or a UK town the app's old list did not know, now also starts with the free feed unticked. One tick turns it on, and your own tick is still remembered (L-419).
- When you paste a job advert, the reader now understands more money signs: A$, C$, NZ$, S$, R$, MX$, ₹, zł and CHF. A plain $ is still read as US dollars, whatever country you search in. South Africa's R is not read as a sign, because one letter is too easy to mistake; a rand advert keeps its pay as written. On the Tracker's "Add application" form, the example in the Currency box follows the country you chose on Search; for the United Kingdom it is GBP, as before (L-418).
- Profile: while you are looking over an imported profile, the greyed-out "Fill it in" button now says why: "Finish the import below first." (L-416).
- The part of the app that asks Adzuna for jobs can now be told which country to search, from the 19 countries Adzuna covers, and salaries from such a search carry that country's currency instead of always pounds. Reed lists UK jobs only, so it is never asked about any other country (L-415).
- The serif typeface, which nothing in the app has used since L-407, is no longer shipped inside it: its three font files and their licence are gone. Nothing on screen changes, and the app is about 65 KB smaller (L-414).
- On the Tracker, a job's status is now five choices side by side (Saved, Applied, Interviewing, Offer, Rejected), not a drop-down. One click changes it, and with the keyboard the arrow keys move between them (L-412).
- On a job in the Tracker, the button that checks your CV against that job now says "Check my CV". It was "Analyse this job", and it does exactly what it did. The same action on a search result keeps its old name for now (L-411).
- On a Tracker card, a next action with a date now takes two lines: your words on the first (ending in "…" when they are longer than the card) and when it is due on the second. Before, the due took its space first, so in a narrow column your words were cut to a word or two, or vanished. The red overdue dot now sits in the card's top-right corner instead of beside the job title, so the title gets the card's full width (L-409).
- The match score, and the example score on the welcome page, are in the same typeface as the rest of the app (Inter, semibold), not the serif. Their sizes are unchanged. Nothing in the app is set in the serif now (L-407).
- Page and section titles are in the same typeface as the rest of the app (Inter, semibold), not the serif. Their sizes and the height of the header bar are unchanged (L-405).
- The top of Tailor has less small print. The line under "Your CV" that listed where your CVs come from is gone. Inside the CV preview, the line above the text now reads "The AI works from exactly this text." (with "Corrected by you." in front once you have corrected it), because the file name is already on the line under the text. A CV with no text now just says "No text could be read from this CV." above the "Type or paste your CV text" button, and the "Add a number" fold opens with "Add a real number or result where you have one. Skip the rest." (L-404).
- The menu is in a new order: Tracker, Search, Analysis, Tailor, then Profile and Settings under a small "You" label (on a phone, the same order along the bottom bar, without the label). No screen was renamed and the app still opens on the Tracker. **The keyboard shortcuts moved with it**: Ctrl+1 is now Tracker, Ctrl+2 Search, Ctrl+3 Analysis, Ctrl+4 Tailor and Ctrl+5 Profile. Before, Ctrl+1 was Profile, Ctrl+3 Tracker, Ctrl+4 Analysis and Ctrl+5 Tailor (L-402).
- On a desktop, opening a card on the Tracker now shows its details in a panel that floats over the right-hand side of the board, instead of pushing the board aside. The board's columns keep their width while a card is open, so they no longer squeeze or scroll sideways. While the panel is open, Tab moves round the panel only, and Escape or Close takes you back to the card. You can still click another card to switch to it. On an empty board the form still opens beside the invitation, and on a phone the panel still covers the screen (L-401).
- On Tailor, the tailored CV is now shown as a page: a white sheet with your name and contact details at the top once you have confirmed them, section headings, role titles and real bullet points. It shows the same sections, order and words as the PDF and Word files you save, but not their page breaks or line breaks. In the save buttons, "Save as PDF…" is now the one main button, and Word and text are under "More formats". Once a job has a draft, its "Tailor CV" button turns grey and reads "Tailor again" (L-400).
- Search is shorter. "Where to look" folds to one line that says what is ticked, such as "Arbeitnow · 2 job boards ticked", so the Search button and the top of the results fit on the smallest window without scrolling. It starts folded every time and is never remembered. Lines that pointed "above" now name "Where to look", and the lines that pointed at board buttons the screen no longer has are fixed (L-398).
- All five Tracker columns now fit side by side at the app's smallest window, so Rejected is no longer pushed off to the right. Each column may now be as narrow as 136px instead of 176px; on a narrower window, or with an application open beside the board, the board still scrolls sideways rather than squeezing the columns (L-397).
- On Tailor's ATS Score step, keyword coverage and bullet strength are now drawn as a Before bar and an After bar, each as long as its number, with the number beside it. The After bar is teal when the score rose, gold when it fell and grey when it did not change. A score that could not be measured shows a dash and no bar. Screen readers hear the same words and numbers as before. The three checks (sections, contact details, length) stay a small table, without its empty fourth column (L-396).
- Less small print on the CV check. The note under the CV picker no longer repeats what the "Save as JSON Resume" button already explains, the sample's intro is one short line, the screening-words block says "Use the advert's word for work you have really done.", and the "Save to tracker" form keeps only "The advert you pasted is saved with it." (L-395).
- Tracker cards now show the whole job title on up to three lines and the company on up to two, instead of cutting them short. A next action with no date now shows on the card in your own words, and an overdue one adds a small red dot beside the title (L-393).
- Each search result now has one clear button, "Save to tracker". "Analyse this job" and "Open original →" moved into a small "…" menu at the end of the same row, with the same words (L-392).
- On a CV check result, the match score now stands out on its own card and is drawn larger. The screening-software keyword check sits on a plain line under it, its number in the same small type as other counts, so the two numbers no longer look like two scores (L-391).
- In Settings, each AI provider, "Your own AI service", Adzuna and Reed is now a short row that opens on click. The closed row shows the name, its status and, once a key is saved, the AI model it uses; everything that was on the card is inside, in the same words. "Your own AI service" saved with no model now says "Choose a model", and the model choice is called "AI model". Search's "Get a free Reed key" opens the Reed row for you (L-390).
- The Search screen's code is split into smaller files, with no change to what you see or what it does (L-389). The "Where to look" box and the "Also open" row move to their own file, so the Search screen goes from 777 lines to 716 and has room under the 800-line limit for the changes that come next.
- The step bar on Analysis and Tailor is slimmer: on a computer it is two rows, with Back and Next beside the job and the five steps joined by drawn lines; on a phone the steps are one row of marks with a line of words under them, such as "Step 4 of 5 · ATS Score. Skipped: Analyse." (L-386).
- A hint's words are no longer underlined. Labels now carry a small circled "i" button that opens the explanation and is what the Tab key reaches; in the ATS table the results (OK, Check, Missing, the change and the band word) have no "i" and open their explanation on hover or a tap. On a touch screen one tap now opens a hint and leaves it open instead of closing it straight away (L-384).
- The strip above the Tracker board now says "Applied so far" and "Interview or offer". "Applied so far" counts every application ever sent, so "Applied 5" above an Applied column of 2 cards no longer looks like a mistake. "Interview or offer" counts the cards in those two columns now. "Saved", "Offers" and "Rejected" are counts of what is there now, so they are unchanged (L-383).
- Page and section titles are bigger, so each screen has a clear top and each section stands out from its text; the header bar stays the same height (L-382).
- The last red error boxes built by hand — on Search, in the search results when a job board or free feed fails, in a job's follow-up panel and in the interview stage editor — are now the one shared error box. They look exactly as before with ordinary messages; a message holding a long file path or web address now wraps inside the box instead of running past its edge. A new check stops another error box being built by hand (L-380).
- The text boxes on Search, the job boards settings, the Settings key cards and Profile now share the same one style as every other text box, kept in one place, and a hand-made copy anywhere in the app fails the build. Nothing on screen changes (L-379).
- The High / Medium / Low label on an analysis suggestion ("Do this first", "Worth doing", "If you have time") now uses the app's one shared small label (L-378). Two things look different: the "If you have time" label is one step darker (the same grey as "Worth doing"; the words still tell them apart), and on a narrow window, beside a long section name, the label now stays on one line and the section name wraps instead of the label breaking onto two lines. Same words, same order, nothing else changes.
- A new check keeps the blue "Start here" badge on the welcome page the only blue pill in the app (L-378).
- The red error boxes in Settings (keys, your own AI service, leftover keys, Report a problem, Delete everything and the backup notice), job boards, CV upload and the CV pickers are now the one shared error box. They look exactly as before with ordinary messages; a message holding a long file path or web address now wraps inside the box instead of running past its edge (L-377).
- The text boxes on Analysis and Tailor now share the same one style as the tracker's, kept in one place, so a later change to how a text box looks is made once. Nothing on screen changes (L-376).
- The main app file's code is split into smaller files, with no change to what you see or what it does (L-373). It was exactly at the 800-line limit, so nothing more could be added to it; it is now 554 lines, plus four hooks (start-up restore of your Tailor work, the update check on launch, the Ctrl+1 to Ctrl+5 shortcuts, and moving a job between screens) and the screen switch. Everything still starts in the same order.
- A new check fails the build if any screen, style file or shared package writes a colour directly (a hex value, `rgb()`, a named colour, a one-off colour class, a built-in Tailwind colour class, an inline style or an icon fill) instead of using the theme's colour list, so every colour on screen is one the contrast checks measure (L-371). The three shadow colours are the only named exceptions, each marked as needing a dark value. Nothing on screen changes.
- The drawn marks beside words are easier to see (L-370). The ticks, crosses, up and down arrows and the back arrow are larger — in the ATS Score table the cross beside "Missing" grows from about 6.5 px to 8.5 px across at the normal 13 px text — and every mark, including the warning triangle and the step dots and rings, is drawn with a slightly bolder line. No row, button or table line changes height, and nothing is cut off or wraps on a narrow window or at 150% zoom.
- The up and down arrows that reorder your job boards (Settings) and your interview stages (Tracker), and the × that removes a saved search, are now drawn by the app instead of typed, so they look the same on every computer (L-369). Each button keeps its name for screen readers, its style, its height, its size on a phone, and stays greyed out rather than hidden when it cannot be used; the job-board arrow buttons are about 2 px wider and the saved-search × button about 3 px wider than before.
- The red error strip under the header on Analysis, Tailor, Tracker and Profile is now one shared part, so the strips can no longer drift apart. The one change you can see: Profile's strip now has the same red-tinted line along its bottom as the others, where it used to be grey (L-368).
- The checks that measure the app's colours now read them in one place, and fail by name on a colour they cannot read, a colour written twice, or a colour set anywhere outside the one light colour set, instead of skipping it (L-366). They also now look at every style file, not only the theme, and refuse a dark-mode class anywhere in the app until a dark colour set is checked on purpose. Nothing on screen changes.
- The tracker's text boxes now share one style, kept in one place, so a later change to how a text box looks is made once. Nothing on screen changes (L-365).
- The ATS Score table's marks (OK, Check and Missing, and the up and down arrows beside a changed score) are now drawn by the app instead of typed, so they look the same on every computer (L-362). OK is a tick, Check a warning triangle and Missing a cross, and a rise and a fall are arrows pointing up and down: each has its own shape, not just its own colour. The words and numbers beside them, and their hover explanations, are unchanged; the marks may look slightly smaller than before, and a screen reader no longer reads out the old typed symbol, only the words, numbers and explanations it already heard.
- The step bar's marks (done, you are here, skipped, not started, and the arrow back to the tracker) and the progress dots on a tracker card are now drawn by the app instead of typed, so they look the same on every computer (L-360). Done, current, skipped and not started each have their own shape, not just their own colour. Their hints no longer quote the old typed symbols, and the card's dots no longer have a dotted underline; hovering or tapping them still explains them, and screen readers hear the same words as before.
- The Profile screen's code is split into smaller files, one per panel, with no change to what you see or what it does (L-359). It was one 890-line file; it is now 337 lines plus two panel files, so it comes off the list of screens allowed over the 800-line limit, and that list is now empty.
- The Tracker screen's loading and saving code moves into three hooks, with no change to what you see or what it does (L-358). `Tracker.tsx` goes from 679 lines to 365. Adding or deleting a card still changes the board and the side pane in the same instant, and a new test fails if either is ever drawn without the other.
- The check that every text box has an edge you can see now follows a shared style into the file it comes from, and fails by name on any part of a box's style it cannot read, instead of skipping it (L-357). It found one box it had been half-reading: the "Due" date on an application's details, whose due-soon and overdue colours it now checks too. Nothing on screen changes.
- The three pop-up windows (deleting an application, sending a CV to an AI service, and checking your details before saving a CV) now share one pop-up, with no change to what you see or how the keyboard works (L-356). Tab stays inside, Escape closes the pop-up and not the panel behind it, and focus goes back to the button that opened it.
- The Tracker screen's code is split into smaller files, one per panel, with no change to what you see or what it does (L-355). It was one 1,000-line file; it is now 679 lines plus five panel files, so it comes off the list of screens allowed over the 800-line limit.
- Groundwork for drawn ticks, warnings and step marks, with no change to what you see yet (L-354). The app can now draw these marks itself instead of using typed characters, so later updates can make them look the same on every computer, and the check that every mark has an explanation you can hover, tab to or tap now covers drawn marks too.
- On a wide window, every screen except the Tracker board now keeps its content in one 1024px column in the middle, with the page title lined up above it, instead of hugging the left edge (L-326).
- Search says where Arbeitnow's jobs come from once, not twice, when a UK location is typed, and the job-board hint now says you can point at a board or tab to it (L-323).
- Search's "Requests today" line stays hidden until a job-board key is saved, and then names only the boards that have one (L-323).
- Settings says who pays for AI once, at the top of the AI provider keys section. Each provider card now keeps only what is different about that provider, and still says who bills you (L-321).
- "Export my data" on Settings is no longer the blue main button. It works the same, in the same place, as an ordinary button (L-321).
- The Profile screen has less small print (L-320). The header now says the page saves as you type, three card notes are shorter and the Languages note is gone. The CV line now reads "Used by default: <name>, the newest of your 3 CVs." instead of "Newest: <name>", and the skills-gap card points to the upload at the top of the page, not to the Analysis screen.
- The Interviewing column's button now reads "Interview stages", with or without stages, instead of "Edit stages" or "Stages" (L-319).
- A started job's card keeps its five dots on one line in a narrow column; the Continue button moves under them instead of squashing them (L-319).
- Every Tracker card now says, in words, how long since its last change — for example "12 days since last change" or "Changed today" — instead of leaving it to the coloured edge (L-318).

### Fixed

- "Withdraw" now appears on Analysis and Tailor for every AI provider you agreed to send your CV to. It only ever appeared for Anthropic and OpenAI, so an agreement given to Google Gemini, Mistral, xAI Grok, OpenRouter or your own AI service could not be taken back in the app (L-399).
- An Adzuna search "within 25 miles" now looks 25 miles out. The app was sending the miles figure where Adzuna expects kilometres, so it only looked about 15 miles. Reed searches were already right and are unchanged (L-394).
- The third count on the Tracker strip is now labelled "Interview or offer", which is what it counts: the cards in the Interviewing and Offer columns now. A job you were interviewed for and then turned down for counts only under "Rejected", because the app does not record that the interview happened. The numbers are unchanged (L-388).
- Two explanations that only showed on mouse hover now open from the keyboard and a tap too: what "Applied so far" counts on the Tracker, and why "Save as JSON Resume" is greyed out (L-387).
- The "Keyword coverage" explanation now gives the score ranges, so keyboard and screen-reader users can find them too, and an explanation opened with a tap now closes when the page scrolls instead of floating over other content (L-385).
- The pictures the test of the real, built Windows app takes are now the same every time for the same code (L-375). Before each picture, the real mouse cursor is moved to an empty spot on the side menu, so nothing is photographed hovered by accident; the whole screen is redrawn at once; and the picture is saved only once nothing is moving, the fonts have loaded and two frames in a row are identical. A screen that never stops changing fails the run and says what moved. Pictures 1, 2, 4 and 6 no longer show a tracker card or a hint mark under the cursor. Nothing in the app changes.
- An error message holding a long file path or web address now wraps inside the red strip on a narrow window, instead of running off the edge where it could not be read, and Tracker's Retry button stays on screen beside it (L-374).
- A box that saves when you click away, such as Headline on your profile or Notes on a tracked application, now saves your change once instead of twice, so a "could not be saved" message stays on screen instead of vanishing a moment later on its own (L-372).
- The WebKit check in CI no longer needs the Ubuntu package servers when its package cache is warm: it installs WebKit's system packages from the cache with no download, so Playwright's `apt-get update` (which, not the packages, failed on 11 Nov 2026) runs only when the cache cannot cover them. When the download still fails, the job stays red and says "No WebKit test ran" instead of an exit code that reads like a failing test (L-367).
- On a narrow window (the phone layout), opening Settings from Search's "Manage job boards" now stops exactly where it aims, with the usual gap above the Job boards section (L-364). The first time in a session it could stop up to about 2px off, because the code font used for ".json" in "Your data" was only loaded after Settings had worked out where to scroll. The app now loads its code font when it starts, and that ".json" line no longer changes height when the font arrives. Nothing looks different. The desktop layout was never affected.
- The check that stops the bright brand teal and gold being used for words now looks only at whole style names, as it was meant to (L-361). Its pattern had a typo, the letter "w" where "any letter or digit" was meant, so it would also have flagged longer names that merely contain "text-teal" or "text-gold". It finds the same nothing as before on the app today. Nothing on screen changes.
- Tailor now opens at the top of its page, with the usual gap above "Your CV" (L-353). It used to open scrolled 20px down (16px on a narrow window), so "Your CV" sat tight under the step bar. The ATS Score and Export steps now stop with that same gap above them instead of flush against the step bar.
- Settings is affected too (L-353). Opened from Search's "Manage job boards" or the Reed key button, it now stops with a 20px gap (16px on a narrow window) above the Job boards section or the Reed card, instead of flush against the top edge.
- A search that finds nothing now says "No matches" once, not twice: the job-board panel carries the hint to try broader words or a wider distance, and when a free feed's own line or a board's error already explains the empty list, the panel just offers the job boards (L-352).
- "Delete everything" with nothing saved no longer says it will delete nothing: it now says there is no work to lose, and that your saved API keys and preferences will still be deleted (L-351).
- When the AI's answer comes back in the wrong shape twice, Analysis, Tailor, Review, Cover letter and Interview prep now say "The AI did not return a usable result. Try again, or try a different model." instead of showing the checker's own text, such as "match_score: Invalid input: expected number" (L-350).
- While a pasted advert is being read, Cancel now looks switched off as well as being switched off (L-349). Four other buttons that copied a shared style by hand (Close on the details panel, "Keep it" when deleting, Discard on a follow-up, and Cancel on the new-application form) now use it, so all five are 44px tall on a phone.
- Analysis and Tailor no longer send a bare link to AI. If you paste only a web address instead of the advert text, the button stays greyed out and says why: CViper can't open links there, so open the page, copy the advert text and paste it in (L-348). Nothing is sent anywhere, and the basic match is blocked too.
- The message for a JSON file that is not a JSON Resume no longer says Reactive Resume exports JSON Resume (L-347). It saves its own format. The message now says some CV builders save their own kind of JSON, and to look for an export called JSON Resume.
- A CV with one readable character now says "only 1 character could be read", not "1 characters", on Analysis and Tailor (L-344).
- The ATS score hint now says "Up 1 point" and "Down 1 point", not "1 points" (L-344).
- On Tailor, your CV text no longer sits in a small box that scrolls inside the page, so the mouse wheel always scrolls the page. A long CV shows its first lines with "Show all" under it, and "Show less" folds it back; a short CV shows in full with no button (L-322).
- The Tracker no longer shows "Interview rate 0%" in teal after one application. Until 5 have been applied, each rate shows a dash and "after 5 applied"; after that it shows in plain ink, never teal, so it no longer looks like good news (L-317).
- The grey example text inside empty boxes is now darker and easier to read. It was half the strength of normal text, too pale to meet the 4.5:1 contrast minimum; it now uses the app's faint text colour, which passes on every background (L-316).
- A button you cannot press now looks like it: disabled grey and text-only buttons, such as "Remove saved key" with no key saved, get a grey fill and lose their outline (L-315).

## [0.12.0] — 2026-11-03

0.12.0 was prepared but never tagged, built or uploaded; everything listed here ships in 0.13.0.

Most of this release is about Search. The Search button now searches inside the app and opens no browser tabs; opening the job boards you ticked is its own button, "Also open in N boards". When Search is greyed out, the reason sits right beside the button, and a UK search with no job-board key gets a "Get a free Reed key" button that goes straight to the key in Settings. On a short desktop window the button stays in view. Guardian Jobs closed on 2 September 2026, so its feed and its board link are gone; jobs you saved from it are kept. Elsewhere, Tailor starts with your CV folded so the job advert box is in view without scrolling, a started job's card on the tracker says which step it is on in words, a CV check starts on a general chat model rather than a coding model, and Profile, Search, Settings, Analysis and Tailor share one reading width so their cards line up.

### Added

- A daily check that the free Arbeitnow job feed still answers (L-339). Once a day CI asks every free feed the app reads for its jobs, through the app's own reader, and fails if a feed redirects, answers with a web page instead of its list, sends a list it cannot read or an empty one, or has no job with a title and a link; it then opens an issue, or adds to the one already open. Guardian Jobs' feed closed on 2 September and turned into a web page, and nothing noticed for two months. Nothing in the app changes.
- For a UK search with no job-board key, a "Get a free Reed key" button now sits beside the greyed-out Search and takes you straight to the Reed key in Settings, with the job-board keys unfolded (L-338).

### Changed

- Profile, Search, Settings, Analysis and Tailor now share one reading width, so their cards line up as you move between them (L-341). Profile, Settings and Search are a little wider than before, and on a very wide window Analysis and Tailor no longer stretch their text across the whole screen.
- On Tailor, your CV now starts folded to one line, with its file name, its word count and "Show CV", so the job advert box is in view without scrolling (L-340). A CV with no text still shows "Type or paste your CV text" straight away.
- A CV check now starts on a general chat model on your PC rather than a coding model, and coding models say they may read CVs less well (L-333).
- A started job's card on the tracker now says which step it is on in words, such as "Step 3 of 5 · Tailor", above its progress dots, and a screen reader hears the same words (L-331).
- Example text in the empty Profile and Search boxes now starts with "e.g.", so it no longer looks like an answer already filled in (L-330).
- Search now always searches inside the app and opens no browser tabs; opening the ticked job boards is its own button, "Also open in N boards", with the same filters. A saved search still opens its boards as well as searching (L-329).

### Fixed

- On Tailor, a one-word CV or cover letter now says "1 word" instead of "1 words" (L-343).
- On a short window the Search button, and the reason it is grey, could fall below the bottom of the screen (L-342). On desktop widths they now stay in view at the bottom of the Search screen until the page reaches them, then scroll away with the form, so they never sit over your results. Phones are unchanged.
- The Guardian Jobs board link is gone from Search and Settings: Guardian Jobs closed on 2 Sep 2026 and the link opened a page that refused it. Nine UK boards remain, and a board you had ticked or saved with a search simply drops out while your other boards stay ticked (L-337).
- Guardian Jobs closed on 2 September 2026, so its free feed has gone from Search and no longer shows "Guardian Jobs sent something CViper could not read" (L-336). Jobs you saved from it are kept and still say where they came from.
- For a UK search with no job-board key, Search now says what will work: a free Reed key, set up in Settings, adds UK jobs here, and the job sites you tick open with "Also open" (L-336).
- When Search is greyed out, the reason now sits right beside the button instead of below the bottom of the window, with a one-press "Tick Arbeitnow" to fix it where there is a free feed to tick, and the empty results no longer say to press a button that cannot be pressed (L-335).
- Going from Search to Settings no longer shifts the whole app up, cutting off the top and leaving a blank strip at the bottom (L-334).
- The Interviewing column's header now reads its name then its count, like every other column, and "Edit stages" sits just under it instead of pushing the count onto a second line (L-332).
- The work-item number check now reads every issue, page by page, and fails if it read fewer than the repository holds; it had stopped at the first 200 (L-328).
- Settings now lists all six things AI adds, not just the full CV reading: tailoring your CV, the cover letter, interview prep, follow-up drafts and Paste a job (L-327).

## [0.11.0] — 2026-10-29

The launch release. The free CV check reads skills it used to miss, now including UK qualifications, licences and checks such as NVQ, DBS and C+E; it shows the line of your CV behind each match and how much the advert gave it to go on, and it no longer counts a skill your CV says you lack. A new user sees a full result in one click, is no longer asked for job-board keys, and is told in plain words how to add AI. There is a tenth UK job board, and three security fixes: AI requests no longer follow redirects, a local Ollama run never goes through a proxy, and a memory issue in backup validation is patched.

Also in this release: you can save a search and run it again in one click, and Search has a button straight to your job-board settings. Text is bigger throughout (16px instead of 14px), and screen readers now read out status messages. A long CV is no longer cut short before it reaches an AI company. Two more security fixes: the app's own page can no longer run database commands, and the database opens only after the safety copy taken before an update.

### Added

- Saved searches on the Search screen (L-309). "Save this search" keeps what is in the boxes and the job boards you ticked, under a name you choose. One click on a saved search fills the boxes, ticks its boards and runs Search. Each one has its own delete button. You can keep up to 10. They stay on this computer, in the app's own storage: "Delete everything" removes them, and backups do not include them. The privacy policy now lists them.
- The test that runs the real, built Windows app now uses it the way a person does (L-301). It adds a job to the tracker, moves it to Applied, closes the app, opens it again, and checks the job is still there and still Applied; then it deletes it, so a developer's own tracker is left as it was. Until now that test only opened screens and read PDFs, and none of it saved anything, so a broken database update would have passed it. Backups are still not driven: export and import open your computer's own file window, which the test cannot click. No app change.
- Colour contrast is now measured on the real, styled app (L-300). Until now it was only checked by matching class names in the code, which cannot see a background painted by a surrounding box, and the accessibility check from L-297 runs in a test browser that paints nothing. Now every main screen, at a desktop and a phone width, plus the sample result, a board with applications and an opened application, is drawn in WebKit and checked with axe against WCAG 2.1 AA (4.5:1 for normal text). Everything passes today. The check first confirms the app's colours actually loaded, because an unstyled page is black on white and would pass every time — that is exactly what the first version of this check measured, until a screenshot showed it. It also proves it can fail, on a deliberately pale sentence. No app change.

- A tip in the box that asks before your CV is sent to an AI company (L-296): "CVs often hold things an employer does not need, like your date of birth, health details or nationality. You can take them out of your CV before you send it." It is the same box on every screen that sends a CV: the CV check, tailoring, Paste a job, interview preparation and follow-ups. It is a tip, not a warning, so it uses no warning colour, and a screen reader reads it out with the question. Only the text of your CV is sent, so photos are not mentioned. Nothing else about the box changes: "Not now" is still where the focus starts.

- The AI key screen now says what to do, in three plain steps (L-293): pick one company (you only need one), press "Where do I get … key?" on its card and make a key on its website, then paste it and press "Test and save this key". It also says the key is kept in your computer's own password store and is only used to talk to that company. No company is recommended. The welcome screen's line for a new machine now reads "No AI is set up yet — the basic word match works with nothing set up, and you can add AI later in Settings." instead of "No local model and no API key found".

- Nice-to-haves you do not show are listed again, but not as gaps (L-292). Since L-289 a missed "desirable" costs nothing and is not in "What they asked for and could not find" — right for the score, but you were no longer told about it. A short list under it now says "Nice to have, not on your CV — these do not lower your score." Basic match only, and only when the advert marks something as desirable.

- A confidence line under every basic-match score (L-291): "Confidence: low — based on only 2 requirements found in the advert. Read the advert yourself before relying on it.", or "Confidence: high — based on 7 requirements found in the advert." A 70 built on two requirements and a 70 built on ten used to look the same. It counts exactly what the score counted, so "low" is exactly when the score is also held below "strong". It describes how much the check had to go on, not how good your fit is, so it is never shown in a warning colour. It is not shown on AI results, whose score does not come from the word list. Low is fewer than 3, medium 3 to 5, high 6 or more; the 6 is a judgement, easy to move.

- Proof behind every match (L-290). Under "What you have", a folded "Show where your CV says this" lists each matched skill next to the line of your CV it came from, so you can check a match instead of taking it on trust. The lines follow the same rules as the score: a line saying you lack a skill ("No SQL at my first job") is never shown as proof, and a skill with no line the check can point to is left out rather than guessed. It works for the sample too, and for AI results wherever the skill's name appears in your CV. Nothing new is saved.

- The free CV check now knows UK qualifications, licences and checks (L-282). It used to find no requirements at all in a care, HGV or teaching assistant advert, so those scores were close to random. A hand-made list of 63 terms — NVQ Level 2 and 3, DBS check, C+E and C licences, Driver CPC, digital tachograph, SIA licence, EYFS, SEMH, EHCP, food hygiene, CSCS-style site cards and more — is now read on both sides, and different wordings of the same thing count as the same thing: a CV saying "Level 2 Diploma in Health and Social Care" meets an advert asking for "NVQ Level 2". On the ten-advert test set the right CV now scores higher in 10 of 10 pairs, up from 6. That set was in view while the list was written, so it shows the list fixes what it aimed at, not that it works on every advert. Words that mean something else in another job are only matched inside a longer phrase, so "CPC" in a marketing advert (cost per click) and "ADR" in a legal one (dispute resolution) are not read as driving qualifications. Tech and finance adverts score exactly as before.

- A test that asks the free CV check the question a user asks (L-281): given a CV that fits the job and one that does not, does the fitting one score higher? Ten real UK adverts (care, charity retail, HGV driving, a school, customer service, treasury, HR, operations, data, security and compliance), requirements paraphrased, with twenty invented CVs, one good and one poor fit each. When it was added, the check got 6 of the 10 pairs the right way round; it gets 10 of 10 after the UK list above. The test pins that number exactly, so a change that makes it worse fails CI, and a change that makes it better must say so by raising it. No app behaviour changes.

- A one-click sample on the Analysis screen (L-277). Before you have added a CV, "Try it with a sample CV" checks a made-up data analyst's CV against a made-up advert with the basic match and shows the full result, so a new user sees what a check gives back before hunting for files. It saves nothing — no CV row, no history — because a single CV cannot be deleted from the app, and a sample would otherwise sit in your list for good. It contacts nothing, it is gone once you add your own CV, and "Hide the sample" puts it away. A test pins the sample to a middle-band result with real gaps, so a scorer change cannot quietly turn the demonstration into a 95 or a "weak".

- Every release now also carries the Mac disk image under one name that never changes, `CViper-Light-macOS.dmg`, next to `CViper-Light-Windows-x64.exe` (L-261), so cviper.ai can offer a Mac download button that never needs a version number. A release with no Mac build (the Apple secrets unset) still ships Windows and says so in its summary; a release with two disk images is refused rather than guessed at. The guard that holds the Windows name now holds this one too, and checks that the signing job can never pick either up.

- A tenth keyless job board: GOV.UK Find a job, the Department for Work and Pensions' Work Hub service (L-262). It is UK-wide, covers every sector, searches by keyword and location, and needs no account; like the other nine it opens in your own browser, and the app never loads or reads the page. The search address uses `keywords`, because the `q` the page also accepts is ignored and returns every job in the country.

### Changed

- On Search, the Search button now comes after everything that changes what it does (L-313). The free feeds, any job boards with a key and the job boards that open in your browser are together in one "Where to look" box under the search boxes, then the button, then "Save this search". Before, the button sat above the job-board ticks it counted ("opens 3 boards"), so it was easy to press before choosing.

- The test that drives the real, built Windows app now also photographs it (L-244). It imports six made-up applications, saves pictures of the Tracker, an open application, the CV check, Search and Settings, then deletes the made-up applications again. CI keeps the pictures for 30 days as "app-screenshots", for the website and the store listings. Nothing in the app changes.

- "JSON Resume" on the Analysis screen now explains itself (L-312): tap it, hover on it or Tab to it to read that it is a standard CV file format some builders and job sites use, and that a PDF or Word file works just as well.
- Search has a "Manage job boards" button on its job-board box (L-310). It opens Settings at the Job boards section, where you choose which boards appear, put them in order and add your own. Before, the only route was a sentence at the bottom of the box.
- The Search screen's code is split into smaller files the same way, with no change to what you see or what it does (L-308). It was one 1,067-line file; it is now 592 lines plus one file per panel, so it comes off the list of screens allowed over the 800-line limit.
- The names in every `index.ts` export list are now in one sorted order, values first and then types (L-307). Two pull requests that each add a name to the same list now usually add it on different lines, so they no longer conflict. A check fails the build if a list falls out of order. Nothing users see changes.
- The Analysis screen's code is split into smaller files the same way, with no change to what you see or what it does (L-306). It was one 1,275-line file; it is now 736 lines plus one file per panel, so it comes off the list of screens allowed over the 800-line limit.
- The Tailor screen's code is split into smaller files, one per panel, with no change to what you see or what it does (L-305). It was one 1,670-line file, so unrelated changes kept editing the same lines and clashing. A check now keeps every screen file under 800 lines; the four already over it may only shrink.
- Changelog entries are now one file per change in `changes/unreleased/`, not a line added to the top of this file (L-303). Every pull request used to insert its entry at the same spot, so any two open at once conflicted: 8 of the 27 pull requests from #370 to #419 needed a conflict fix, and 8 of those 10 fixes were here. `pnpm changelog:release <version> <date>` gathers the files into a release; a check fails the build if an entry is written straight into this file again.
- No person is named in the app's source, test data or docs any more (L-298), at the owner's request. Example CVs in the tests use an invented name, comments and docs say "the owner", the licence reads "The CViper Light authors", and the App Store copyright line is "© 2026 CViper". A test fails the build if a banned name comes back; it keeps the names only as SHA-256 hashes, so it does not name anyone itself. Some places still name the owner, each for a reason: the privacy policy (UK GDPR asks it to name who controls the data, and changing that is a legal decision), the Microsoft Store publisher name (it must match Partner Center exactly), and the GitHub account name in every link, including the one the updater checks. Nothing about how the app works changes.
- Bigger text everywhere (L-241). Normal text is now 16px instead of 14px, small text 13px instead of 12px, and nothing in the app is smaller than 11px. A check now fails the build if any of those slip back.

- Plain words for AI outside Settings (L-295). Screens a new user meets before setting anything up said "Needs a local model or your own key.", "No local model or key set up" and "Extraction needs an AI provider (free with Ollama, or your own key)". They now say "Needs AI — add it in Settings.", "No AI set up yet" and "Reading the advert needs AI — add it in Settings (one kind is free), or add the job manually." The two empty screens say they need "no account and no set-up" instead of "no API key". Settings still explains the two kinds of AI, in the three steps from L-293. The consent dialog keeps its exact wording ("using the API key you added"), because it must say precisely how your CV is sent. A test now fails the build if "local model", "your own key", "API key" or "AI provider" comes back on a screen outside Settings.

- Sixteen JavaScript dependencies updated, including Tauri's command-line tool to 2.12.3 (L-294). The automatic update had been failing since 25 October, on purpose: the Windows installer uses CViper Light's own copy of Tauri's installer template, and a test refuses a Tauri upgrade until that copy is compared with the new stock one. The comparison found one change, which is now taken as is: upgrading by hand removes the old version's leftover uninstaller file and its empty folder instead of leaving them behind. It runs after CViper Light's silent upgrade step and touches no saved data or keys.

- The free check now knows the difference between what an advert needs and what it would like (L-289). Missing a "desirable" or "nice to have" no longer costs as much as missing an essential: it costs nothing, and it is not listed as a skill you are missing. Having one still counts in your favour. It reads "Desirable:", "Nice to have", "It would be great if you have", "Bonus points for" and "Ideally" headings, and lines marked "(desirable)" or "would be an advantage". A score can only go up compared with before, never down. Adverts that mark nothing are scored exactly as before. On the ten test adverts, the teaching assistant's good fit moves from 56 to 64 ("possible"), because GCSE English and Maths is only desirable there; eight pairs are unchanged.

- The free check no longer calls a match "strong" on one or two requirements (L-287). When it can recognise fewer than three things an advert asks for, the score is capped at 74, the top of "possible", and the summary says why: "Only 1 requirement could be recognised in this advert, so the score is capped…". Before, a care advert with one recognised requirement gave a matching CV 92, "strong", on a single phrase. Adverts with three or more recognised requirements score exactly as before, and the cap only ever lowers a score. Job search sorts by these bands, so a thin advert now sorts with the "possible" matches.

- Six everyday English words are no longer read as tech skills unless they are written like one (L-286). "The rest of the round" on a care CV counted as REST APIs, "I go to de-escalation first" as the Go language, and "window displays" as Microsoft Windows; in an advert, "the rest of the team" made REST a requirement every applicant then missed. Now go, rest, react, windows, swift and rust count only when written with a capital (Go, REST, Windows Server) or on a line with another tech skill, such as "python, go, rust". On the twenty test CVs this drops exactly those three false matches and keeps the real "Windows Server". Words like Excel, testing and risk are left alone on purpose, because hiding a skill someone has is worse.

- A higher UK qualification now counts for the lower one it includes (L-285). A CV with NVQ Level 3 meets an advert asking for NVQ Level 2, and a C+E licence meets one asking for a C licence, which you cannot hold C+E without. Only the CV side is widened: an advert asking for Level 3 is not read as also asking for Level 2, and a CV that says "No NVQ Level 3" gets neither.

- The WebKit check in CI no longer depends on a fast Ubuntu mirror (L-284). Its install pulls about 70 system packages, and on 26 October the mirror served them at a few kB/s three times; the L-280 cap stopped the job hanging but still failed it. apt now keeps those packages in a folder CI saves and restores, so a warm run downloads only what Ubuntu has updated since. Tested on Ubuntu 24.04 with a small package: without the change, the image deletes the package after installing it and the next install downloads it again; with it, the next install needs 0 bytes. A contract test fails if the cache, the apt setting or the report step goes missing. No app change.

- A slow package mirror can no longer hold the WebKit check for 20 minutes (L-280). Twice on 26 October the browser install ran out the whole job: not a hang, but the Ubuntu mirror serving WebKit's system libraries at 20-40 KB/s, against a normal install of under a minute. Each install attempt is now capped at 5 minutes and a slow one is retried once on a fresh connection. Before the retry, a small script stops the apt-get the cap leaves behind (it runs under sudo, out of `timeout`'s reach, and kept the dpkg lock so the first version of this retry failed in a second) and repairs any half-done install. A contract test holds both caps and the lock release. This shortens the stall and usually recovers it; caching the system packages would remove the download altogether and is not done here.

- Job-board keys are out of the first-run path (L-276). The welcome card for search no longer says "Free keys add more results", and the Search screen no longer shows a row of greyed-out Adzuna and Reed boxes on a machine with no key. A new user sees the free feeds and the board buttons, which need nothing. The keys still work and are still one fold down in Settings under "Job-board keys (optional)"; the moment either key is saved, or half-saved, the row comes back exactly as before, with each board's reason and its Settings link.

- The app starts with about 700 kB less code to load. The libraries that read a Word CV and write a Word export (`mammoth`, `docx`, `jszip`) were in the main bundle and parsed on every launch, though most sessions never touch a Word file; they now load the first time a Word file is read or saved. The main chunk drops from about 1.6 MB to 900 kB. A contract test forbids static imports of either.

- Release and Store builds are harder to tamper with and harder to stall. Every checkout in the release and Store workflows drops the job's GitHub token instead of leaving it in `.git/config`, where any build dependency could have read it and replaced a published installer. The Store package now waits for CI to pass on a commit on `main`, as releases already did, so a package can no longer be built from a red or unmerged commit. Rust is pinned to 1.99.1 in `rust-toolchain.toml` and in every workflow, so the compiler changes only when a PR says so. CI and smoke runs on `main` are no longer cancelled by a burst of merges, which used to leave a tag waiting on a manual re-run: each commit on `main` now gets its own concurrency group, because turning `cancel-in-progress` off still let GitHub cancel a pending run when a third merge arrived. Every job now has its own timeout instead of GitHub's six hours. Four new contract tests hold all of this.

### Fixed

- On the Tracker board, the Interviewing column's count no longer runs into the next column's name ("1OFFER") when an application is open or the window is narrow (L-311). "Edit stages" and the count now move under the column name when there is no room beside it.

- A long CV is no longer cut to its first 6,000 characters when it goes to an AI company (L-302). That limit was set for the small AI that runs on your own PC, but every AI got it, and nobody was told. When tailoring, it meant the new CV was rewritten from the first 6,000 characters only, so later jobs and your education could be missing from it. Now an AI company is sent up to 16,000 characters — a long, four-page CV — and is given room to send the whole tailored CV back. The AI on your PC still reads 6,000, because that is what it can hold. When your CV is longer than the AI you picked will read, the CV check and Tailor screens now say so before you start: "Your CV is 9,200 characters long. This AI is sent the first 6,000, so anything after that is not read." A CV under 6,000 characters is sent exactly as before.
- Screen readers now read status messages out (L-299). About 25 messages — "Key saved", "Sending your CV to…", "Drafting the letter", "No applications match your search" and the rest — appeared on screen with their words already in them, and a screen reader often stays silent about a message that arrives that way. Each screen now keeps a hidden message area ready from the start and writes the words into it, so the message is read out once. Nothing changes on screen. The grey "Check this CV", "Tailor CV" and "Read the advert" buttons are now linked to the sentence beside them that says why they cannot be pressed, so a screen reader reading the button reads the reason too. A test fails the build if a status message is ever added the old way again.
- Four more messages are now read out by screen readers (L-238): the "new version available" strip, "Continue where you left off", "Done — those keys are removed", and "Only N matches in CViper's sources" on Search. Each appeared with its words already in it, which screen readers do not reliably announce. A check now fails the build if any visible message is marked as a status message again; its words go through a hidden status line that is always on the page.

- Headings on the CV check result and the interview panel are now in the right order for screen readers (L-297). The result's sections ("What you have", "What they asked for and could not find" and the rest) jumped from the screen's main heading straight to a third-level one, and the interview panel went from the job title to a fourth-level one, so someone moving by heading met what sounded like a missing section. Found by a new automatic check: axe, the engine behind browsers' own accessibility tools, now looks at every main screen as a new user first sees it, plus the sample result, a board with applications on it, an opened application and the box that asks before a CV is sent. It checks WCAG 2.0, 2.1 and 2.2 at levels A and AA, plus axe's best-practice rules, on every pull request. It cannot judge colour contrast, because the test browser does not draw the page. Nothing else about any screen changes.

- Skill names are now spelled the same in the free check's advice as in its lists (L-288). The lists already showed "SQL" and "Power BI", but the advice under them said "The advert asks for Sql" and "Power Bi", because the sentences skipped the step that fixes names for the screen. That step now runs inside the check itself, so every name it writes is right wherever it appears. Joining words also stay small: "Literacy and Numeracy", "End of Life Care". Nothing about any score changes.

- The free CV check no longer counts a skill your CV says you do not have (L-283). "No CPC or tachograph card yet" used to count as holding a tachograph card, and "Driver CPC not held" as holding a CPC. Now a skill right after "no", "not", "without", "lacking", "do not have" or "don't hold", or right before "not held", "expired" or "lapsed", is not counted — unless the CV names it somewhere else as well. The rule is narrow on purpose, because hiding a skill you hold is worse than the old bug: "not only", "no less than", "never", "non-technical", "working towards" and "pending" still count as having it. It changes only which skills are read from the CV; the advert and the ATS keyword check are read as before. On the twenty test CVs it removes exactly one skill — the tachograph card that CV says it lacks.

- The free CV check no longer misses a skill that ends a sentence or shares a slash (L-275). "Advanced Excel.", "residents with dementia." and "Python/Django" all hid the skill, because the word matcher treated `.` and `/` as part of the word; the check then told people to add words their CV already had. A full stop now ends a word unless a letter follows it, so `node` still does not match inside `node.js`, and a slash now separates two skills. Hyphens are unchanged on purpose: splitting them would make "go" match "go-to-market". The same matcher feeds the match score, the keyword score, the skills panel, search ranking and the Tailor comparison, so all of them gain the fix. This is a deliberate break from the old web app's scorer, which had the same defect; that app is mothballed, so there is nothing left for the two to disagree about.

- A crash on one screen no longer takes the whole app down. There was one error boundary, round everything, so a render error on Tailor (say) blanked the window, menu included, and "Try again" re-rendered the same broken screen. Each screen now has its own: the menu and the other screens keep working, and moving to another screen starts it clean. The error message is still never shown, since it can carry CV text.

- Keyboard and screen-reader focus now follows you to the new screen. Switching screens dropped focus to the top of the page, so a keyboard user had to tab through the menu to find where they were; the new screen's heading now takes focus (WCAG 2.4.3).

- A local Ollama run no longer goes through a proxy. The app's network client honoured `HTTP_PROXY`/`ALL_PROXY` and the system proxy settings, with no exception for `127.0.0.1`, so on a machine with a proxy set (common on work laptops and with some VPNs) the CV and advert sent to Ollama travelled to that proxy in plain HTTP. Ollama now has its own client that never uses a proxy and never follows a redirect; every cloud provider keeps the proxy, so users who need one can still reach them. A test runs the real request against a fake proxy in a child process and fails if the local request reaches it.

- Screen readers no longer repeat the "model is thinking" message every second. The running seconds counter sat inside the live status line, so each tick changed it and Narrator or NVDA read the whole sentence again. The counter is still shown, but hidden from the accessibility tree, so the message is read once.

- Fetch from a link now refuses private addresses hidden inside IPv6 transition prefixes. On an IPv6-only network with NAT64 (common on work Wi-Fi and phone tethering), an advert whose name resolved to `64:ff9b::c0a8:101` reached the user's router at 192.168.1.1; 6to4 (`2002::/16`) carried the same trick. The IPv4 address inside both is now judged as itself, and local-use NAT64 (`64:ff9b:1::/48`), Teredo (`2001::/32`) and the old site-local range (`fec0::/10`) are refused. The custom AI provider check shares the rule, so it tightens there too.

- Keyboard focus is visible again in Windows High Contrast. The focus ring is drawn with a box-shadow, which High Contrast removes, and the rule beside it said `outline: none`, so a keyboard user there saw no focus at all. The ring now also carries a transparent outline: invisible normally, repainted in the system highlight colour under High Contrast. A contract test holds it.

### Security

- A build tool used by Tailwind, `source-map-js`, is updated from 1.2.1 to 1.2.2 to clear a high-severity advisory (a crafted source map could stall the process) that turned the dependency audit red (L-304). It runs only while the app is being built, never inside the app you install.
- The app's own page can no longer run any SQL it likes against your database (L-243). It used to hold the database plugin's query permissions, so a script that got into the page could have run `ATTACH DATABASE` and written a file anywhere you can, such as the Windows Startup folder. Now every query goes through two of the app's own commands, which run a statement only if its exact text is one of the 50 the app was built with; anything else is refused before the database is touched. Nothing changes in what the app stores or shows. A check fails the build if the page is given a SQL permission again, or if the list in Rust and the statements in the app disagree.
- The app now opens its database itself when it starts, after the safety copy it makes before an update (L-243). The page has no database permission left at all, and no longer carries the database plugin's code. If the database cannot be opened, every screen that needs it says why.

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

- The privacy policy now says who is responsible and how to reach them privately (L-231). It names the developer, a sole trader in the UK, as the controller, and privacy questions go to cviperuk@gmail.com instead of only the public issue tracker, where anything you write is visible to everyone. New sections cover the lawful basis for the little we handle ourselves (emails to that address), your rights and how to complain to the ICO, international transfers (a service you choose may be outside the UK), how long things are kept, and our website, naming GitHub Pages and the Cloudflare redirect from cviper.uk. The policy carries a "Last updated" date and says it is for people aged 16 and over, replacing the US "under 13" wording. A test fails if any of these sections goes missing (#240).
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

[Unreleased]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.17.0...main
[0.17.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.16.0...light-v0.17.0
[0.16.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.15.0...light-v0.16.0
[0.15.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.14.1...light-v0.15.0
[0.14.1]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.14.0...light-v0.14.1
[0.14.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.13.1...light-v0.14.0
[0.13.1]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.13.0...light-v0.13.1
[0.13.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.11.0...light-v0.13.0
[0.12.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.11.0...light-v0.13.0
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
