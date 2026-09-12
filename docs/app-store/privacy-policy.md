# CViper Light privacy policy

_For CViper Light 0.1.0. This page is generated from the app's own list of the addresses it may contact — the same list the app shows under Settings → Privacy, and the one a test holds the code to. It changes when that list changes and not otherwise._

## The short version

CViper Light has no account to create, no server of ours behind it and no analytics in it. Your CV text, your saved jobs and your applications are stored on your own device, in a database that belongs to the app. The app contacts another service only when you press a button that says it will, and only the services listed on this page.

We — the people who make CViper Light — receive nothing from it. Not your CV, not your searches, not your keys, not whether you use it at all. The one address on this page that is ours, cviper.ai, is only ever opened in your own browser when you tap a line that names it; the app never contacts it, and what that site sees is what your browser shows it.

## What the app keeps, and where

- **Your jobs, applications, CV text and every analysis** — one database file, cviper.db, in this app’s data folder for your user account.
- **Your API keys** — this device’s credential store (the Keychain on an iPhone, iPad or Mac; Credential Manager on Windows; the Secret Service on Linux), one entry per key.
- **Which job boards you enabled and how you ordered them** — job-boards.json in the same data folder.
- **Small conveniences: your last search, today’s request count, and that you have seen the introduction** — this app’s own browser storage, which no other program reads.

## Every address the app can contact

This is not a summary. It is the exact set of addresses the code is allowed to name; a test fails the build if one is added without appearing here.

### Sent with your own key, when you ask

These carry a key you pasted into Settings, under an account that is yours. The bill, if there is one, is between you and that provider.

- `api.openai.com` — A CV analysis you start, sent with your own OpenAI key under your own OpenAI account.
- `api.anthropic.com` — A CV analysis you start, sent with your own Anthropic key under your own Anthropic account.
- `api.adzuna.com` — A job search you start, sent with the free Adzuna key you registered yourself.
- `www.reed.co.uk` — A job search you start, sent with the free Reed key you registered yourself. Reed’s developer page is also opened in your browser from Settings.

### Only when you press a button, with no key

A plain request with nothing about you in it beyond the request itself.

- `github.com` — The update check reads a small signed file from this app’s public GitHub releases. It happens when you press “Check for updates”, and carries no data about you beyond the request itself. The source code is also opened in your browser from Settings → About.

### Opened in your browser, never by the app

The app hands the address to your own browser and is not involved from then on. What that site sees is what your browser shows it.

- `developer.adzuna.com` — The page where you register your own Adzuna key. Opened in your browser from Settings; the app does not load it.
- `platform.openai.com` — The page where you create your own OpenAI API key. The welcome screen and the OpenAI card in Settings hand the address to your browser when you tap it; the app never loads it, and nothing is added to the link.
- `www.linkedin.com` — A keyless search link for LinkedIn, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.
- `uk.indeed.com` — A keyless search link for Indeed, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.
- `www.totaljobs.com` — A keyless search link for Totaljobs, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.
- `www.cv-library.co.uk` — A keyless search link for CV-Library, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.
- `www.adzuna.co.uk` — A keyless search link for Adzuna’s public search, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.
- `www.google.com` — A keyless search link for Google Jobs, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.
- `jobs.theguardian.com` — A keyless search link for Guardian Jobs, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.
- `www.jobserve.com` — A keyless search link for Jobserve, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page, and it never scrapes Jobserve.
- `cviper.ai` — The full CViper, and the page about this app. Three one-line signposts and the About entry in Settings hand the address to your browser when you tap them; the app never loads it, and nothing is added to the link.

### Stays on this computer

A program running on this same machine. The request never reaches the internet.

- `127.0.0.1` — Ollama, if you installed it. The request goes to a program on this computer, not to the internet.
- `localhost` — Named only so the fetch-from-link guard can refuse it. Never contacted.

## Services you may choose to use

If you paste an API key for OpenAI, Anthropic, Adzuna or Reed, the app sends the request you start to that service under your own account, and that service handles what it receives under its own privacy policy, not this one. The key itself is stored in your device's credential store (the Keychain on Apple devices, Credential Manager on Windows), and the app has no way to read it back into the screen.

If you run Ollama, the analysis goes to that program on the same device and not to the internet.

A keyless job-board link is handed to your own browser. What that site sees is what your browser shows it; the app is not involved from then on.

## Deleting your data

Settings → Delete everything removes the database, every saved key and the preferences, and the app returns to its first-run state. Do that before uninstalling if you want the keys gone as well: on some systems the credential store keeps an app's entries after the app itself is removed.

## Children

CViper Light is a job-application tool and is not directed at children under 13. It collects no data from anyone.

## Questions

Ask on the public issue tracker: https://github.com/stevenbrady1/cviper-light/issues. The source code is public under the MIT licence, so every statement on this page can be checked against it.
