# CViper Light privacy policy

_This page is generated from the app's own list of the addresses it may contact — the same list the app shows under Settings → Privacy, and the one a test holds the code to. It changes when that list changes. Last updated: 28 October 2026._

## The short version

CViper Light has no account to create, no server of ours behind it and no analytics in it. Your CV text, your saved jobs and your applications are stored on your own device, in a database that belongs to the app. The app contacts another service only when you press a button that says it will, or switched it on — and only the services listed on this page. Two things happen on their own: when the app starts it reads this app’s GitHub releases to see whether there is a newer version, unless you switch that off in Settings; and it asks this same computer whether Ollama is running, a request that never leaves it.

We — the people who make CViper Light — receive nothing from the app itself. Not your CV, not your searches, not your keys. The places that hand it out — an app store, or GitHub, where the update check looks — may show us totals, such as how many times it was downloaded, without saying who you are. The one address on this page that is ours, cviper.ai, is only ever opened in your own browser when you tap a line that names it; the app never contacts it, and what that site sees is what your browser shows it.

## What the app keeps, and where

- **Your jobs, applications, CV text and every analysis** — one database file, cviper.db, in this app’s data folder for your user account.
- **Tailoring you have not saved yet: the advert, the draft CV, its review and the letter, for each job** — the same database file, on this computer only — an export always leaves it out.
- **A safety copy of that database, made just before an update changes how it is stored, so an update that goes wrong cannot lose your data** — cviper.db.before-update in the same data folder — only ever one, replaced at the next such update.
- **Your API keys, and the address of an AI service you added, kept with its key** — this device’s credential store (the Keychain on an iPhone, iPad or Mac; Credential Manager on Windows; the Secret Service on Linux), one entry per key.
- **Which job boards you enabled and how you ordered them** — job-boards.json in the same data folder.
- **Which AI providers you agreed to send your CV to** — ai-provider-consent.json in the same data folder.
- **Which job you were last tailoring for, so it can be offered back — its id only, no text** — workflow.json in the same data folder.
- **Small conveniences: your last search, your saved searches, which free job feeds you ticked, which job boards Search opens, which AI model each service uses, today’s request count, that you have seen the introduction, and that you were asked about keys left by an earlier install** — this app’s own browser storage, which no other program reads.

## Every address the app can contact

This is not a summary. It is the exact set of addresses the code is allowed to name; a test fails the build if one is added without appearing here. Three things below have no fixed address — the advert page you choose, an AI service you add yourself, and Windows itself — so they are described instead of named.

### Sent with your own key, when you ask

These carry a key you pasted into Settings, under an account that is yours. The bill, if there is one, is between you and that provider.

- `api.openai.com` — A CV analysis, or a pasted job advert, that you start, sent with your own OpenAI key under your own OpenAI account.
- `api.anthropic.com` — A CV analysis, or a pasted job advert, that you start, sent with your own Anthropic key under your own Anthropic account.
- `generativelanguage.googleapis.com` — A CV analysis, or a pasted job advert, that you start, sent with your own Google Gemini key under your own Google account.
- `api.mistral.ai` — A CV analysis, or a pasted job advert, that you start, sent with your own Mistral key under your own Mistral account.
- `api.x.ai` — A CV analysis, or a pasted job advert, that you start, sent with your own xAI key under your own xAI account.
- `openrouter.ai` — A CV analysis, or a pasted job advert, that you start, sent with your own OpenRouter key under your own OpenRouter account. OpenRouter passes the request on to the company that runs the model you use. Its key page is also opened in your browser from Settings; the app never loads that page.
- `api.adzuna.com` — A job search you start, sent with the free Adzuna key you registered yourself. Adzuna’s API requires both parts of that key — the app ID and the app key — as parameters in the web address, so they appear in Adzuna’s own request logs. The request also carries your search words and location, which is what a search is, and Adzuna sees your IP address, exactly as it would if you searched on its own site yourself.
- `www.reed.co.uk` — A job search you start, sent with the free Reed key you registered yourself, carrying your search words and location — Reed sees those and your IP address, exactly as it would if you searched on reed.co.uk yourself. Reed’s developer page is also opened in your browser from Settings, and so is a keyless search link for Reed from job-boards.json; the app never loads either page.
- **an AI service you add yourself in Settings, at the address you type there** — Contacted only if you add one. A CV analysis, a tailoring, a pasted job advert, a follow-up or an interview pack that you start, after you agree, is sent to the address you typed, with the key you saved for it, if any. The address must start with https:// and be on the internet, unless you tick that the service runs on your own computer or network, and then it must be there instead. Its key is kept with that address and is never sent anywhere else. Settings also asks the service which models it offers. The app follows no links the service sends back.

### Only when you press a button, with no key

A plain request with nothing about you in it beyond the request itself.

- `www.arbeitnow.com` — The list of recent jobs this free job board publishes, read when you press Browse. It takes no key and no account, and nothing about you is sent — the site sees your IP address, exactly as it would if you opened its job board in your browser. It cannot search: CViper reads the recent list and narrows it down on your computer.
- `jobs.theguardian.com` — Guardian Jobs’ public list of its twenty most recent UK jobs, read when you press Browse. It takes no key and no account, and nothing about you is sent — the site sees your IP address, exactly as it would if you opened the page yourself. Its own search page is also opened in your browser by the keyless buttons on the search screen, and the app does not load that one.
- `github.com` — The update check reads a small signed file from this app’s public GitHub releases. It happens when you press “Check for updates”, and once when the app starts unless you switch that off in Settings. It carries no data about you beyond the request itself. The source code is also opened in your browser from Settings → About.
- **any job-advert page you ask it to open — only when you press Fetch, or Analyse this job on a search result** — You paste a link and press Fetch, and the app reads that one page so it can fill in the form. Pressing Analyse this job on a search result that carries only a preview of the advert reads that result’s own page, once, so the whole advert is scored. The address is whichever one you pasted or the result links to, so it cannot be listed here in advance. It carries no cookies, no sign-in and no key, it cannot reach your saved keys, it follows no links, and addresses on your own computer or home network are refused. The site sees your IP address, exactly as it would if you had clicked the link yourself.

### Opened in your browser, never by the app

The app hands the address to your own browser and is not involved from then on. What that site sees is what your browser shows it.

- `developer.adzuna.com` — The page where you register your own Adzuna key. Opened in your browser from Settings; the app does not load it.
- `platform.openai.com` — The page where you create your own OpenAI API key. The welcome screen and the OpenAI card in Settings hand the address to your browser when you tap it; the app never loads it, and nothing is added to the link.
- `console.anthropic.com` — The page where you create your own Anthropic API key. The Anthropic card in Settings hands the address to your browser when you tap it; the app never loads it, and nothing is added to the link.
- `aistudio.google.com` — The page where you create your own Google Gemini API key. The Google Gemini card in Settings hands the address to your browser when you tap it; the app never loads it, and nothing is added to the link.
- `console.mistral.ai` — The page where you create your own Mistral API key. The Mistral card in Settings hands the address to your browser when you tap it; the app never loads it, and nothing is added to the link.
- `console.x.ai` — The page where you create your own xAI API key. The xAI Grok card in Settings hands the address to your browser when you tap it; the app never loads it, and nothing is added to the link.
- `ollama.com` — Ollama’s download page. When Ollama is running on your computer but has no model that can chat, the CV check, the tailor screen and the welcome screen offer this link, which hands the address to your browser when you tap it; the app never loads the page, and nothing is added to the link.
- `www.linkedin.com` — A keyless search link for LinkedIn, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.
- `uk.indeed.com` — A keyless search link for Indeed, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.
- `www.totaljobs.com` — A keyless search link for Totaljobs, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.
- `www.cv-library.co.uk` — A keyless search link for CV-Library, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.
- `www.adzuna.co.uk` — A keyless search link for Adzuna’s public search, from job-boards.json, and the word “Adzuna” on each Adzuna advert, which Adzuna’s API terms ask to link to their site. Pressing either hands the address to your own browser; the app never loads the page.
- `www.google.com` — A keyless search link for Google Jobs, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.
- `www.jobserve.com` — A keyless search link for Jobserve, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page, and it never scrapes Jobserve.
- `www.jobs.service.gov.uk` — A keyless search link for GOV.UK’s Find a job (the Work Hub service run by the Department for Work and Pensions), from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page, and it never scrapes it.
- `cviper.ai` — This app’s own website: its download page and the privacy policy, opened in your browser when you tap a line that names it. The app never contacts it, and nothing is added to the link.

### Stays on this computer

A program running on this same machine. The request never reaches the internet.

- `127.0.0.1` — Ollama, if you installed it. The app checks on its own — when it opens, and again each time you change screens — whether Ollama is running, by asking this same computer. Nothing about this ever leaves this computer, whether or not Ollama answers.
- `localhost` — Named only so the fetch-from-link guard can refuse it. Never contacted.

### Done by Windows, not by this app

Part of the operating system, around the app rather than inside it. It is listed because it is a real request leaving your PC, and left out it would look like something this app was hiding.

- **Microsoft, for the Windows WebView2 runtime this app draws in** — WebView2 is part of Windows, not part of this app. It updates itself and checks downloads with SmartScreen on Microsoft’s schedule. CViper Light does not start those requests, cannot see them and cannot switch them off; they happen for every program on your PC that uses WebView2, whether or not this one is running.

## Services you may choose to use

If you paste an API key for an AI provider, or for Adzuna or Reed, the app sends the request you start to that service under your own account, and that service handles what it receives under its own privacy policy, not this one. The key itself is stored in your device's credential store (the Keychain on Apple devices, Credential Manager on Windows), and the app has no way to read it back into the screen.

If you run Ollama, the analysis goes to that program on the same device and not to the internet.

A keyless job-board link is handed to your own browser. What that site sees is what your browser shows it; the app is not involved from then on.

## Deleting your data

Settings → Delete everything removes the database, every saved key and the preferences, and the app returns to its first-run state. Do that before uninstalling if you want the keys gone as well: on some systems the credential store keeps an app's entries after the app itself is removed.

## Our website

cviper.ai is served by GitHub Pages, and cviper.uk and www.cviper.uk are redirected to it by Cloudflare. The site sets no cookies and loads no analytics script. The app itself never contacts it; its pages open in your own browser when you tap a line that names them. Like any web host, GitHub and Cloudflare see your IP address and keep server logs of the requests they handle, under their own privacy policies, and may show us traffic totals. We do not use them to identify anyone, and they cannot be connected to anything in the app.

## Who is responsible

CViper Light is made by Steven Brady, a sole trader in the United Kingdom. For the little personal data described here that we handle ourselves, he is the controller under UK data-protection law. You can reach him privately at cviperuk@gmail.com.

## Our lawful basis

The app sends us nothing, so there is nothing from the app for us to need a lawful basis for. What you keep in it stays on your own device, under your control. When you send a request to a service you chose, that service handles it under its own terms.

We handle personal data ourselves in one case: when you email cviperuk@gmail.com, we read your message and reply to it. Under the UK GDPR we do that on the basis of legitimate interests — yours and ours, in answering what you asked — or, when you are using one of your rights below, because the law requires us to respond. The server logs kept by our website’s hosts rest on legitimate interests too: keeping a website working and secure.

## Your rights

Under UK data-protection law you have the right to access the personal data we hold about you, to correct it, to delete it, to restrict or object to how we use it, and to have a copy in a portable form. The data the app keeps is on your own device, so you can see, export, change or delete it yourself at any time. For an email you sent us, write to cviperuk@gmail.com and we will reply within one month. For what a service you chose received, ask that service: it is the one that holds it.

If you are unhappy with how we have handled your data, please tell us first so we can put it right. You also have the right to complain to the Information Commissioner’s Office (ICO), the UK’s data-protection regulator, at ico.org.uk/make-a-complaint or on 0303 123 1113.

## International transfers

We transfer nothing, because the app sends nothing to us. If you choose an AI service or a job board, your request goes straight from your device to that service, which may be outside the UK — many are in the United States. That is your choice, made when you press the button, and the service handles what it receives under its own terms and safeguards. A program on your own computer, such as Ollama, keeps the request on that computer. GitHub and Cloudflare, who host our website, may keep their server logs outside the UK under their own safeguards.

## How long things are kept

What the app keeps on your device stays there until you delete it. Settings → Delete everything removes all of it at once; we cannot delete it for you, because we never have it. A service you chose keeps what it received for as long as its own policy says. An email to cviperuk@gmail.com is kept only for as long as we need it to answer you, and then deleted.

## Age

CViper Light is a tool for finding work, meant for people aged 16 and over. The app sends us nothing, so we collect no data through it from anyone, of any age.

## Questions

For anything about your own data, email cviperuk@gmail.com. General questions about how the app works are welcome on the issue tracker, https://github.com/stevenbrady1/cviper-light/issues, but everything posted there is public, so please leave out anything personal. The source code is public under the MIT licence, so every statement about the app on this page can be checked against it.
