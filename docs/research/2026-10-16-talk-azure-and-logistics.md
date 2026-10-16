# Talk notes: Azure environment, LLM models, and hackathon logistics

> Settled guidance from this note is folded into [`CLAUDE.md`](../../CLAUDE.md),
> [`docs/agent/INDEX.md`](../agent/INDEX.md), and
> [`docs/agent/HACKATHON.md`](../agent/HACKATHON.md). This note keeps the full detail.

Notes from the Microsoft part of the Rakathon 2026 pre-hack day (second
recording, 15 October 2026). The session had no slide deck: the presenter
showed the team portal, the Azure portal, and the GitHub Copilot app live,
then answered questions from the Zoom chat.

- **Session**: what Microsoft and the general partner VZP (the Czech
  general health insurance company, whose Azure tenant hosts the
  environment) give teams for the hackathon: an Azure resource group per
  team, a shared set of deployed LLM models, GitHub Copilot licences, and
  technical coaches. The host added logistics (when data is released,
  Slack channels, rules on reusing earlier work).
- **Speakers** (labels are automatic):
  - `speaker_0`: the host and organizer, called "Tomáš" / "Tome" by the
    presenter [rec2 00:48:15] [rec2 01:03:29]. His surname is not said in
    this range.
  - `speaker_1`: the Microsoft presenter, introduced as "Michala Marušana"
    (Michal Marušan, spelling from the automatic transcript) [rec2 00:11:54].
    In the chat he appears as "Michal (MSFT)".
  - `speaker_2`: a participant with an open microphone (side chatter,
    00:13:05 to 00:17:01), not a presenter.
  - `speaker_3`: someone who relays chat questions to the presenter
    [rec2 00:48:42] [rec2 00:53:41]. Possibly the host under a second label.
  - In the chat, "Lada Vasicek, MSFT" answered questions in writing.
  - `speaker_4` (from 01:12:09, Ondřej Hoferek of InterSystems) and
    `speaker_5` (from 02:13:06, Luc Châtillon, HL7 Europe / PHOENIX) belong to
    later sessions. Only a few of their lines are used here, marked as such.
- **Sources**:
  - Transcript: `docs/sources/presentations/GMT20261015-105031_Recording.elevenlabs.md`
    (Czech, ElevenLabs, timestamps from the start of the recording).
  - Zoom chat: `docs/sources/presentations/GMT20261015-105031_RecordingnewChat.txt`.
  - Cross-check only: `docs/sources/presentations/GMT20261015-105031_Recording.cc.vtt`
    (Zoom captions, low quality, starts at 00:23:42).
- **Time range**: 00:00:01 to 01:11:10. The first 7 minutes are waiting-room
  chatter. The host opens at 00:09:54, the presenter speaks from 00:12:15
  to 01:03:59, and Q&A runs until the host hands over to InterSystems at
  01:11:10. The closing remarks (02:44:45 to the end, 02:50:22) were also
  read for logistics.
- **Citation format**: `[rec2 hh:mm:ss]` is the start of the transcript
  paragraph that contains the statement (paragraphs are up to two minutes
  long). `[chat hh:mm:ss]` is a Zoom chat timestamp. `[rec2 cc hh:mm:ss]` is
  a Zoom caption timestamp, used only where the ElevenLabs transcript has a
  gap. Chat timestamps match the recording until the 30-minute break after
  01:11; after the break the chat clock runs about 27 minutes ahead of the
  recording (the chat question at [chat 02:34:40] is read out at
  [rec2 02:06:48]), so the recording was probably paused during the break
  (inference).

## Summary

Every team gets its own empty Azure resource group in a subscription run in
the VZP tenant, with the Contributor role, and a team account (a UPN plus a
time-limited Temporary Access Pass) handed out from the start of hacking.
A small team portal at `aka.ms/Rakathon2026` shows one API key for a shared
set of LLM deployments (OpenAI, xAI Grok, DeepSeek, Microsoft models),
their endpoints and deployment names, and a hello-world call in REST and
Python; the models speak the OpenAI API, both Chat Completions and
Responses. These Azure models are meant for the app the team builds, while
coding help comes from GitHub Copilot, where each participant can activate
a licence with about 100 USD of prepaid credit. Azure is optional: a local
demo is fine, and using Azure does not affect the judging, though sponsor
prizes are hard to win without the sponsor's technology. Spending is capped
by budgets of roughly 100 to 200 USD per team, GPU machines are blocked by
default, the shared LLM endpoint is rate limited (expect HTTP 429 and
retry with backoff), and teams cannot assign RBAC roles or touch Entra ID.
Challenge data is not on the portal except for the VZP challenges; all
other challenge data, including ours, will be posted to each challenge's
Slack channel at the latest after the opening block on the morning of
16 October. Code written before the hackathon may be reused only if the team
declares it openly, because the jury judges what was built during the
event. The hackathon opens at 9:30 in Prague, Brno, and Ostrava at the same
time, and rules and judging criteria are presented then.

## Guidance for our challenge

### Infrastructure and tools

- The Azure environment is optional. Teams may stay on their own laptops;
  Azure is offered "pokud byste se rozhodli nezůstat vlastně na lokále" (if
  you decide not to stay local) [rec2 00:13:12].
- About 70 teams are expected, and each one gets access to its own empty
  resource group in which it is Contributor ("v zásadě admin", basically
  admin) [rec2 00:13:12].
- The resource group is named `RG-<team name>`, using the team name on the
  access card. Each team should see exactly one resource group in
  `portal.azure.com` [rec2 00:58:00].
- If you can see another team's resource group, setup went wrong: do not
  touch it [rec2 00:24:13].
- Access card: each team gets a UPN (a sign-in name of the form
  `team@<domain>`) and a Temporary Access Pass (TAP, a password valid only
  for a limited time). Cards are handed out from the start of hacking on
  16 October, either on site or through Slack [rec2 00:17:06]
  [rec2 01:04:00].
- The team portal lives at `aka.ms/Rakathon2026` (transcribed as "aka tečka
  ms lomeno Rakathon dva tisíce dvacet šest" and "AKMS Rakathon 2026"),
  also reachable by QR code [rec2 00:17:06] [rec2 00:26:13].
- The portal shows, in this order: the team's API key for the LLM models, a
  hello-world call, the endpoint address, one card per deployed model with
  its deployment name and endpoint, the datasets (VZP challenges only), the
  GitHub Copilot sign-up QR code, and links to Microsoft docs with deployment
  examples [rec2 00:26:13] [rec2 00:28:14] [rec2 01:01:28] [rec2 01:03:29].
- One API key covers all deployed models [rec2 01:01:28].
- Deployed models, as transcribed: "Open AI poslední modely Astra, šest jedna
  Sol, ale i menší modely Luna" (OpenAI's latest models "Astra" and "6.1
  Sol", plus smaller "Luna" models for speed), "Nejnovější Grok od XiA"
  (the newest Grok from xAI; "XiA" is a mis-transcription of xAI),
  "Deep Sea poslední" (the latest DeepSeek), Microsoft models, and image
  generation models. The presenter called these models from "roughly four
  or five providers" and said the list may grow [rec2 00:19:07]
  [rec2 00:26:13]. The exact names must be read from the portal (see open
  points).
- Call the models through the OpenAI API with an API key, the deployment
  URL, and the deployment name. Any framework works. Both the Completions
  and the Responses API are available, but check that you use the right
  endpoint and API version for the model [rec2 00:19:07] [rec2 00:21:07].
- Deployment names encode the model version and where it is deployed:
  "že je deployovaný v Evropě nebo, nebo globálně přes celý svět" (deployed
  in Europe or globally). Copy the exact deployment name from the portal
  [rec2 00:21:07].
- Treat the API key as a secret: send it in a request header, keep it in an
  environment variable or a secret store, and do not commit it
  [rec2 00:19:07] [rec2 00:21:07].
- Never put an API key in frontend code that runs in the browser
  [rec2 00:40:13].
- The Azure models are intended for the app itself ("v rámci fungování té
  výsledné aplikace", inside the running application). GitHub Copilot is the
  intended coding tool [rec2 00:19:07].
- All teams share the same LLM endpoints, which are rate limited. On HTTP
  429 ("quota exceeded"), the app must retry with exponential backoff
  [rec2 00:46:14].
- On HTTP 401 or 403, report it to the coaches; a limit may have triggered
  or access may have been revoked [rec2 00:48:44].
- Budget: the limits are "not fixed", but plan on about 100 to 200 USD of
  Azure spending per team [rec2 00:46:14]. Later the presenter said 100 to
  200 USD "na zhruba ten den" (for roughly the day), not guaranteed, and
  that some teams may hit the amount sooner [rec2 00:56:00]. See open points.
- When a budget or limit is exceeded, some services may become unavailable
  or stop working. Most services are pay-as-you-go [rec2 00:46:14].
- Free tiers are shared across the whole subscription, so another team may
  already have used one up. If a free tier is unavailable, pick a paid tier
  [rec2 00:44:14].
- GPU machines and other expensive VMs are blocked by default. Ask the
  coaches on Slack if you really need one [rec2 00:24:13].
- Other Azure services are not restricted in principle [rec2 00:24:13].
- Permissions: teams have the Contributor role only. They cannot assign
  RBAC roles, because the tenant is controlled by VZP. Needs such as managed
  identities or Key Vault role assignments should be discussed with the
  coaches on Slack [rec2 01:05:31] [chat 01:05:10].
- No access to Entra ID (the identity service) or Azure DevOps. The offer is
  the Azure portal plus GitHub Copilot, and the Copilot licence includes
  GitHub, so code can live on GitHub [rec2 00:33:48].
- Suggested Azure services: Static Web Apps for a static page or a single
  page app (has a free tier) [rec2 00:38:13]; Azure Functions as a backend
  for forms and workflows, connected to Azure SQL, PostgreSQL, HorizonDB
  ("Horizon DB"), or Cosmos DB [rec2 00:40:13]; Durable Functions for
  stateful processing of document sets [rec2 00:42:13]; Azure Container
  Apps for a Docker backend such as FastAPI [rec2 00:44:14].
- Azure Copilot inside the Azure portal can explain best practices and has
  a deployment agent that creates resources from a request
  [rec2 01:00:00].
- InterSystems offers a container image with its health data tooling that
  can be deployed into Azure with one command; details were in the next
  session [rec2 00:26:13].
- GitHub Copilot: every participant (not every team) can activate a paid
  licence by scanning the QR code on the portal, which adds their GitHub
  account to a GitHub organization. A team of five can have five licences
  [rec2 00:28:14] [rec2 00:36:12] [rec2 00:38:13].
- Use a personal GitHub account for Copilot, not the team Azure account
  [rec2 00:36:12].
- If your GitHub account already has a paid Copilot plan (private or work),
  create a new account. Joining the organization replaces your existing
  licence, and you would have to restore it later [rec2 00:36:12].
- The prepaid Copilot credit is about 100 USD per account. It is cut off
  when the hackathon ends or the credit runs out, so there are no extra
  costs [rec2 00:36:12] [rec2 00:54:00] [rec2 01:01:28].
- One Copilot "AI credit" equals one US cent. The presenter was unsure
  whether 100 USD is 100,000 or 10,000 credits; at one cent per credit it is
  10,000 (inference from his own numbers) [rec2 00:54:00].
- The Copilot model picker shows the credit price per model. Example given:
  Claude Opus 5.5 ("Cloud Opus pět pět") costs 2,000 credits per million
  output tokens [rec2 00:54:00].
- Copilot offers models from OpenAI, Anthropic, Google, xAI, and others
  [rec2 00:50:45].
- Copilot runs in VS Code, in a terminal (Copilot CLI), and in the GitHub
  Copilot app, which the presenter recommends for running several agent
  sessions in parallel. Sign in with the account that holds the licence
  [rec2 00:30:14] [rec2 00:32:14].
- Copilot can also run cloud agents on GitHub, which keep working when your
  laptop sleeps; they spend the same credit [rec2 00:56:00].
- Copilot uses Claude Code skills as they are ("jedna k jedný", one to
  one) [rec2 00:30:14].

### Data access

- All challenge data will be shared at the latest after the opening
  morning block on 16 October, in the Slack channel of each challenge:
  "Všechna data budou nasdílená nejpozději potom zítřejším, zítřejším
  úvodním dopoledním bloku a budou ... nasdílená do kanálu na Slacku
  konkrétních výzev" (all data will be shared at the latest after
  tomorrow's opening morning block, in the Slack channels of the specific
  challenges) [rec2 00:23:42].
- The team portal contains data only for the VZP challenges: a dataset
  description and an anonymized dataset. Data for other challenges must be
  shared by the challenge authors [rec2 00:21:07] [rec2 00:23:08].
- Teams may also use any publicly available data [rec2 00:24:13].
- No data formats or FHIR servers were described in this session.

### Hackathon logistics and timeline

- The opening is on 16 October at 9:30, in Prague, Brno, and Ostrava at the
  same time. It includes the challenge introductions, meeting the mentors,
  and the rules and judging criteria [rec2 02:46:22].
- Hacking starts after the morning opening programme ("po dopolední
  parádě, představení výzev", after the morning show and the challenge
  introductions) [rec2 01:09:58].
- The Prague venue is the Plzeňská campus of the Second Faculty of
  Medicine, Charles University, in Motol, which also streams the opening
  [rec2 02:48:22].
- Finals and the hacker prize are on Sunday. Participants vote for the
  hacker prize themselves, and the organizers encourage teams to come to
  Prague on Sunday [rec2 02:48:22].
- The hackathon lasts 24 hours; the InterSystems speaker stressed this
  twice [rec2 02:07:09] [rec2 02:10:48]. No submission deadline was given in
  this session.
- Slack channels named in the session:
  - team channels, named after the team, created by following
    instructions repeated on 16 October [rec2 01:04:00];
  - one channel per challenge, where the data appears [rec2 00:23:42];
  - "Tech Support" for technical help [rec2 01:04:00] [rec2 01:07:58];
  - "Hledám mentora" (looking for a mentor) [rec2 01:04:00] [rec2 01:07:58];
  - "Oznámení" (announcements) [rec2 01:06:53].
- Microsoft coaches help mainly with Azure, but also with app architecture,
  frontend, and AI apps. They offer technical, not medical, knowledge. One
  of them does not speak Czech. Contact goes mainly through Slack; some
  coaches are also on site in each city [rec2 00:15:13] [rec2 01:01:28].
- Mentors are on Slack from the start of hacking; the host was not sure
  they are fully available before then [rec2 01:07:58] [rec2 01:09:58].
- Online mentors cover the night in shifts (said by the InterSystems
  speaker, outside this range) [rec2 02:04:31].
- When asking the coaches for help, say which team you are, which endpoint
  or deployment failed, and when, so they can check the logs. For Copilot
  problems, give your GitHub login [rec2 00:48:44] [rec2 00:58:00].
- The presenter's material is a GitHub Pages site, not slides; it will be
  posted to the Slack "Oznámení" and "Tech Support" channels
  [rec2 01:06:43] [rec2 01:06:53].
- The recordings and slides of the pre-hack day will be made available
  [rec2 01:09:58].

### What the jury and the challenge owners expect

- The goal is a proof-of-concept prototype ("proof of concept prototyp")
  [rec2 01:07:58].
- Using Azure does not affect the judging: "Má vliv na hodnocení výzev
  použití Azure? Ne, nemá." (Does using Azure affect the judging? No.)
  [rec2 01:07:18]. The host repeated: "není to povinný a nebude to součástí
  hodnocení" (it is not mandatory and will not be part of the evaluation)
  [rec2 01:07:58].
- Sponsor prizes are the exception: an InterSystems prize, and possibly a
  Microsoft prize, are hard to win without using that sponsor's technology
  [rec2 01:07:58].
- The host recommends open, interoperable standards, because they make a
  later rollout in hospitals and at VZP easier [rec2 01:07:58].
- Only what is built during the hackathon counts. Earlier work may be
  reused, but the team must say exactly which parts existed before and
  which were built during the event, also when presenting to mentors.
  Tools and data sources should be listed too [rec2 00:35:13].
- All submissions will be published [rec2 00:35:13].
- Because AI agents speed up the work, the jury expects higher-quality
  results than at earlier hackathons: "porota pak čeká, že i ta kvalita
  těch výstupů bude ... vyšší než obecně" (the jury will expect the quality
  of the outputs to be higher than usual) [rec2 02:48:22].
- The host joked that the rules do not yet mention orchestrating extra AI
  agents alongside the team; the rules are presented on 16 October
  [rec2 00:09:54] [rec2 02:46:22].

### Privacy, legal, and safety constraints

- The presenter gave no rule about which data may go to which model.
- The only answer on this came later, from the InterSystems speaker, in a
  part the ElevenLabs transcript skips: cloud models are fine if the
  challenge owner confirms the data is anonymous and may be sent to them;
  otherwise a local model would be appropriate, and the organizers do not
  offer one. "Pokud budete mít potvrzený od zadavatele výzvy, že ty data
  jsou anonymní, a že je můžete posílat do těch cloudových modelů, tak v tu
  chvíli je v pořádku" (if the challenge owner confirms that the data is
  anonymous and you may send it to cloud models, then it is fine)
  [rec2 cc 02:08:19] [rec2 cc 02:08:38].
- He added that most challenge owners tried to provide synthetic or
  anonymized data so it can go to cloud models, but each team should check
  with the challenge owner or the hospital's technical team; the check will
  probably happen when the data is handed over [rec2 cc 02:09:01]
  [rec2 cc 02:09:18].
- Some Azure deployments run in Europe and some globally, and the
  deployment name shows which. For hospital documents, prefer an EU
  deployment (inference) [rec2 00:21:07].
- Never paste your Temporary Access Pass or API key into Slack, including
  messages to coaches [rec2 00:48:44].

### Recommended practices and pitfalls

- Handle rate limits in code from the start: retry 429 responses with
  exponential backoff [rec2 00:46:14]. With about 70 teams on one endpoint,
  plan for slow or refused calls during the demo (inference).
- Read the deployment name and endpoint from configuration, since the
  portal is the only source of the exact names and new models may appear
  [rec2 00:26:13] (inference: matches our rule to pin model IDs).
- In Copilot, use large models and high reasoning effort for architecture
  and planning, smaller and cheaper models for routine coding and for
  sub-agents, and a different model to review the work [rec2 00:50:45]
  [rec2 00:52:46] [rec2 00:54:00].
- Do not run everything on the largest model ("nervat všechno jakoby
  Astrou", do not push everything through Astra); credits are limited, and
  your own subscriptions can be combined with the Copilot credit
  [rec2 00:54:00] [rec2 00:56:00].
- Use Git worktrees (separate checkouts of the repository) to run several
  agent sessions on different branches at once [rec2 00:58:00].
- A hackathon project is a small proof over a small amount of data, so
  scaling features are not needed [rec2 00:44:14].
- If a key, budget, or permission problem blocks you, ask on Slack early;
  the coaches promise to unblock teams as fast as they can
  [rec2 00:21:07] [rec2 00:46:14].

## Directly about challenge 2

Nothing in the Microsoft session (00:00:01 to 01:11:10) mentions the MDT
assistant, Fakultní nemocnice Ostrava, or its data. What applies to us
indirectly:

- Our data is not on the Azure portal, which holds only VZP data
  [rec2 00:21:07]. It should arrive in the challenge 2 Slack channel at the
  latest after the opening block on 16 October [rec2 00:23:42].
- Whether FN Ostrava's documents may be sent to the shared Azure LLM
  deployments depends on the challenge owner confirming they are anonymous
  or synthetic [rec2 cc 02:08:38].
- Outside this range, the InterSystems speaker named FN Ostrava as a user
  of InterSystems technology for integration and interoperability between
  hospital systems: "jedna, která tuhle technologii pro tyhle účely
  používá, tak je právě třeba fakultka v Ostravě" (one hospital that uses
  this technology for these purposes is the university hospital in
  Ostrava) [rec2 01:14:55]. This hints that FN Ostrava's systems may expose
  data through InterSystems tooling or FHIR (inference).

## Questions and answers

1. **Do the Microsoft tools include Azure DevOps and Entra ID, or only the
   Azure portal?** (JakubLorenc) [chat 00:31:34]. Only the Azure portal
   and GitHub Copilot. Sign-in goes through Entra ID, but teams get no
   rights in it because the environment runs in the VZP tenant. Azure
   DevOps is not offered; the Copilot licence includes GitHub
   [rec2 00:33:48].
2. **May we use a general boilerplate and UI components prepared before
   the hackathon, if we say transparently what was made before and during
   it?** (Lenny Kranjec) [chat 00:34:00]. The presenter: from his side,
   almost anything goes [rec2 00:34:32]. The host: yes, but declare it
   openly, also to the mentors, because only what is built during Rakathon
   counts; list tools and data sources too; submissions will be published
   [rec2 00:35:13].
3. **Do we present the project in production, that is in Azure, or is a
   local setup enough?** (Oliver Stroch) [chat 00:43:57]. Answered in the
   chat by Lada Vasicek (Microsoft): "kdekoliv - stačí lokál, pokud by vám
   Azure nevyhovoval" (anywhere, local is enough if Azure does not suit
   you) [chat 00:48:12].
4. **Are the LLM limits large? Can one prompt start about 20 sub-agents?**
   (Drking262) [chat 00:49:11], relayed at [rec2 00:53:41]. The Copilot
   licence has about 100 USD of credit per account, which goes a long way
   but is not unlimited; give sub-agents smaller, cheaper models; check
   per-model credit prices in the model picker [rec2 00:54:00]. Azure
   limits are flexible; plan on 100 to 200 USD per team for a large job
   [rec2 00:56:00].
5. **Do we get only the Contributor role in our resource group, or can we
   assign RBAC roles (for managed identities and Key Vault access)?**
   (Daniil Khmelnytskyi) [chat 01:05:10]. Contributor only, because VZP
   controls the tenant. Contact the coaches on Slack to work out a
   solution [rec2 01:05:31]. The asker agreed to follow up on Slack
   [chat 01:06:55].
6. **Will the presentation be shared with those who missed it?** (the host)
   [rec2 01:06:32]. Yes. It is a GitHub Pages site and will be posted to
   Slack "Oznámení" and "Tech Support" [rec2 01:06:43] [rec2 01:06:53].
7. **Does using Azure affect the judging, for example because hospitals
   accept it more readily than SaaS hosts like Heroku or Railway?**
   (JakubLorenc) [chat 01:07:40]. No. It is recommended and helps a later
   rollout, but it is not mandatory and not part of the evaluation; sponsor
   prizes need the sponsor's technology [rec2 01:07:18] [rec2 01:07:58].
8. **"No chance to get csv data file today?"** (Alex Yudzin)
   [chat 01:07:40]. Not answered in the recording. The earlier statement
   stands: data arrives at the latest after the opening block on
   16 October [rec2 00:23:42].
9. **Is it appropriate or allowed to use cloud LLMs for RAG and chatbots
   with health data, even fake or anonymized, or are local models needed?**
   (JakubLorenc, asked during the InterSystems session) [chat 02:34:34].
   Answered by the InterSystems speaker: allowed if the challenge owner
   confirms the data is anonymous and may go to cloud models; otherwise use
   a local model, which the organizers do not provide; check with the
   challenge owner [rec2 cc 02:08:19] [rec2 cc 02:09:18].

## Open points

- **Budget period.** 100 to 200 USD per team is described once as enough
  "for the duration of the hackathon" [rec2 00:46:14] and once as "for
  roughly the day" [rec2 00:56:00]. Ask the coaches what the real cap is
  and what happens when it is reached.
- **Exact model names.** "Astra", "šest jedna Sol", and "Luna" may be
  garbled or may be OpenAI model names we do not know. Read the exact
  deployment names, their regions (EU or global), and the API version from
  the portal on 16 October, then pin them in `.env.example`.
- **Data protection for challenge 2.** Confirm with FN Ostrava (the
  challenge owner) whether its data is synthetic or anonymized and may be
  sent to the shared Azure deployments, and whether only EU deployments are
  acceptable. No one in this session stated a rule for health data.
- **Copilot credit.** The presenter said both 100,000 and 10,000 credits for
  100 USD; at one cent per credit it is 10,000.
- **Rate limits.** No numbers were given for the shared LLM endpoint.
  Measure early whether our extraction volume (many documents per patient)
  fits.
- **Managed identities and Key Vault.** Teams cannot assign roles, so a
  deployed app may not be able to read secrets from Key Vault without coach
  help. Keeping the key in app settings or environment variables avoids
  this (inference).
- **Slack channel names.** The host said "Tech Support", the InterSystems
  speaker said "Tech Helpdesk" [rec2 02:04:31], and the host later said
  "helpdesk" [rec2 02:08:28]. Check the real channel name on Slack.
- **Third partner.** The host named the technology partners as
  "InterSystems, Microsoft a SECA" [rec2 00:09:54]. "SECA" may be a
  mis-transcription; check who it is.
- **Deadlines.** The session gives no time for the end of hacking or for
  submission, and no judging criteria; both are promised for the opening on
  16 October [rec2 02:46:22].
- **Microsoft prize.** The host said there "may" be a Microsoft prize
  [rec2 01:07:58]. Check at the opening.
