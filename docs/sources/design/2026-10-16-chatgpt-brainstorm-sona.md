# Brainstorming MDT asistenta

**User:** Anonymous  
**Created:** 10/16/2026 16:02:17  
**Updated:** 10/16/2026 16:02:18  
**Exported:** 10/16/2026 16:03:13  
**Link:** [https://chatgpt.com/share/6ad22e69-0290-83ed-8fb6-a3e096eeacf7](https://chatgpt.com/share/6ad22e69-0290-83ed-8fb6-a3e096eeacf7)  

## Prompt:
16/10/2026, 01:17:54

![02B448EA-8735-4693-B586-511F72FDA8C9.png](https://sdmntprnortheu.oaiusercontent.com/files/00000000-54b8-81f4-ba22-50c59f45dd00/raw?se=2026-10-16T14%3A08%3A06Z&sp=r&sv=2026-02-06&sr=b&scid=69876dc0-075e-4280-b27e-ab5a849fd840&skoid=5c9dda00-298b-4376-81e9-b4568c8a3c0f&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2026-10-16T04%3A49%3A08Z&ske=2026-10-17T04%3A49%3A08Z&sks=b&skv=2026-02-06&sig=Vbtg070DmhBR46L1EgNVxvmn41kgwLeAp15ArvRAwS4%3D)

ideme developovať 2 na rakathone dnes v ostrave, pomôž mi s brainstormingom, potom ti poviem ako som nad tým premýšľala ja

## Response:
16/10/2026, 01:17:56 · gpt-6

Super\! Poďme to uchopiť ako **klinický problém, nie ako AI projekt**\. Pri téme č. 2 – *AI asistent multidisciplinárního týmu* – vidím potenciál vytvoriť niečo, čo by som ako lekárka chcela používať pred každým onkologickým MDT.

A zároveň si myslím, že najzaujímavejšie nebude samotné sumarizovanie dokumentácie. To dnes zvládne takmer každý kvalitný LLM. **Skutočná hodnota bude v tom, ako AI pripraví podklady na klinické rozhodnutie.**

## 1\. Čo je vlastne problém, ktorý riešime?

Predstavme si typické onkologické MDT.

Lekár potrebuje pred zasadnutím prejsť množstvo dokumentácie: histológiu, zobrazovacie vyšetrenia, laboratórne výsledky, predchádzajúcu liečbu, konzíliá a zápisy z hospitalizácií.

Informácie sú roztrúsené, opakujú sa, niekedy si odporujú a niektoré chýbajú.

**Dnes\:** Lekár manuálne rekonštruuje príbeh pacienta.

**Naša vízia\:** AI pripraví štruktúrovaný klinický prípad, upozorní na neistoty a umožní lekárovi sústrediť sa na rozhodovanie.

## 2\. Čo by som chcela, aby náš asistent dokázal?

Navrhla by som päť funkčných vrstiev, ale na hackathone by som sa sústredila na prvé tri.

**A. Clinical snapshot**

Jednostranový, klinicky relevantný prehľad: diagnóza, TNM, histológia, biomarkery, ECOG, komorbidity, doterajšia liečba a aktuálny dôvod prezentácie na MDT.

Nie obyčajné zhrnutie dokumentácie, ale informácie prioritizované podľa konkrétnej klinickej otázky.

---

**B. Interaktívna časová os**

Od prvých príznakov cez diagnostiku, staging, operáciu a systémovú liečbu až po aktuálny stav.

Vizuálne zvýraznenie progresie, zmien liečby, komplikácií a dlhých časových intervalov.

---

**C. Missing information &amp; contradictions**

Toto je podľa mňa jeden z najväčších diferenciátorov.

AI identifikuje napríklad chýbajúce výsledky biomarkerov, nejasný staging, rozpory medzi histológiou a diagnózou či neaktuálne vyšetrenia. Musí však odlišovať skutočný rozpor od informácie, ktorá sa v čase zmenila.

---

**D. MDT decision support**

Systém pomáha formulovať, o čom má MDT rozhodnúť, aké možnosti prichádzajú do úvahy a aké informácie sú potrebné na rozhodnutie.

Voliteľne môže pracovať s aktuálnymi guidelines, ale bez automatického vydávania liečebných odporúčaní.

---

**E. Post-MDT workflow**

Po zasadnutí pripraví návrh zápisu: rozhodnutie, ďalšie kroky, zodpovednosti a termíny. Lekár ho skontroluje a schváli.

## 3\. Ako by mohol vyzerať náš produkt?

**MDT Copilot**

(Ukážka konceptu)

---

Pacient \#ONC-024

64 rokov · Kolorektálny karcinóm

(Na kontrolu)

Diagnóza

**Adenokarcinóm sigmy**

KRAS mut., MSS

Aktuálna liečba

**FOLFOX + bevacizumab**

Po 7. cykle

**Clinical timeline**

1. 05/2026 – Diagnóza
   
   Kolonoskopia, histologická verifikácia
2. 06/2026 – Začiatok liečby
   
   FOLFOX, redukcia 5-FU pre DPYD variant
3. 10/2026 – MDT
   
   Posúdenie odpovede a ďalšieho postupu

**Čo vyžaduje pozornosť?**

Chýbajúci výsledok restagingu

V dodanej dokumentácii sa nenašiel aktuálny CT nález.

Otázka pre MDT

Aký ďalší postup zvoliť na základe odpovede na systémovú liečbu?

Ilustračný prípad so syntetickými údajmi. V reálnom produkte by každé tvrdenie malo mať odkaz na pôvodný dokument.

## 4\. Čím môžeme na hackathone skutočne zaujať?

Myslím si, že by bolo zaujímavé ísť nad rámec generického chatbotu.

**Môj favorit je koncept „MDT readiness“ – pripravenosť prípadu na multidisciplinárne rozhodnutie.**

Predstav si, že asistent dokáže povedať\:

- Prípad je pripravený na MDT, všetky kľúčové informácie sú dostupné.
- Prípad možno prerokovať, ale chýba jeden relevantný výsledok.
- Prípad vyžaduje doplnenie zásadných podkladov pred definitívnym rozhodnutím.

Nie ako nepriehľadné AI skóre, ale ako transparentný checklist s vysvetlením, prečo konkrétny údaj chýba a odkiaľ pochádzajú ostatné informácie.

Druhá zásadná vec je **traceability**\: keď AI uvedie „pacient má KRAS mutáciu“, lekár musí vedieť jedným kliknutím otvoriť konkrétny molekulárno-patologický nález, z ktorého to vychádza.

## 5\. Čo by som prioritizovala na jednodňový hackathon?

| Funkcionalita | Klinická hodnota | Náročnosť MVP |
|--------|--------|--------|
| Clinical snapshot | Veľmi vysoká | Nízka |
| Časová os | Vysoká | Stredná |
| Chýbajúce informácie | Veľmi vysoká | Stredná |
| Citácie do dokumentácie | Kritická pre dôveru | Stredná |
| MDT readiness checklist | Veľmi vysoká | Stredná |
| Guidelines engine | Potenciálne vysoká | Vysoká |
| Integrácia do NIS | Vysoká | Veľmi vysoká |

Na demo by som pripravila jeden syntetický onkologický prípad s 10–15 dokumentmi, úmyselne vloženým rozporom a chýbajúcim výsledkom. Ukázali by sme, že AI z nich za krátky čas vytvorí použiteľný MDT podklad, pričom lekár dokáže overiť každé podstatné tvrdenie.

A merala by som dve veci: **koľko času lekár ušetrí a koľko klinicky relevantných informácií systém správne zachytí**\. Samotná rýchlosť bez presnosti nestačí.

---

Teraz ma veľmi zaujíma, **ako si nad tým premýšľala ty**\.

Najmä či si uvažovala skôr nad AI, ktorá *pripravuje pacienta pred MDT*, alebo nad asistentom, ktorý *aktívne pomáha počas samotného zasadnutia*\. To sú totiž dva dosť odlišné produkty a podľa mňa by sme si mali vedome vybrať, ktorý problém chceme vyriešiť najlepšie.

## Prompt:
16/10/2026, 09:24:08

And also I was thinking that when we have all this integrated that we need to think about the fact that before in DT we only have a fraction of information available because when we were working with guidelines documents, we already had the whole process of diagnosis and therapeutics. So there's that. So also we need to think about, like you're saying, those moments when there is not enough information, for example, or there are conflicting information. Therefore there needs to be some kind of alert that shows that some information is missing. Then you're so right that this can be also that can be summarizing the patient before MDT, so no one needs to spend more time preparing for this. But also, it would be super cool if we had this kind of feature that listens to the conversation of the doctors and... Also contributes to the decision-making process, deciding the course of treatment that will be chosen for this specific patient, in accordance with guidelines. Also, already with the data available that we prepare for the patient, for this specific patient, we might have some suggestions already from the guidelines.

ask me qs

## Response:
16/10/2026, 09:24:09 · gpt-6

I think you've identified something really important: **GLIDE evaluates care retrospectively, when the clinical trajectory is already known. This MDT assistant would need to support decisions prospectively, with incomplete and evolving information.** That fundamentally changes how we should design the system.

And I love the idea of moving from a passive summarization tool to an **active, guideline-aware MDT copilot** that participates in the discussion without replacing clinical judgment.

I want to challenge your thinking a little, because I think we can develop a much more interesting product than the original hackathon brief.

## Let's start with 5 questions

[Discuss my answers]

One more thought I'd like us to explore after your answers: **the AI should distinguish between three very different situations** — information that is genuinely missing, information that is present but contradictory, and information that is simply not yet available because the patient is at an earlier point in the diagnostic pathway.

For example, an MDT discussing a newly diagnosed head-and-neck cancer patient before definitive staging should not be evaluated against the same information requirements as an MDT deciding on adjuvant treatment after surgery.

That distinction could become one of the most clinically intelligent features of the entire product.

## Prompt:
16/10/2026, 10:05:04

My answers for the MDT copilot design:
1. At what point should the AI start evaluating guidelines?
Both — prepares an initial assessment and updates it dynamically as the discussion progresses

2. How proactive should the AI be during the meeting?
On demand — doctors can ask questions about guidelines and patient data

3. What should happen when essential information is missing?
Also suggest the specific investigation or clarification needed

4. How should the AI present treatment recommendations?
Present guideline-supported treatment options with references, leaving the choice to clinicians

5. What would make the strongest hackathon demonstration?
Show the complete journey: before, during and after MDT

Please challenge these choices and help me develop the architecture and hackathon MVP.

## Response:
16/10/2026, 10:05:06 · gpt-6

I think your answers point toward a much more ambitious and clinically meaningful product than a documentation summarizer.

What you're describing is essentially a **guideline-aware, real-time MDT copilot** that understands the patient's current clinical situation, recognizes uncertainty, retrieves relevant evidence, and helps clinicians make informed decisions.

But I would challenge three assumptions before we start building.

## 1\. Three decisions I would challenge

### A. Should the AI really wait to be asked?

You chose an on-demand assistant during the MDT, which makes sense. Doctors don't want an AI interrupting their discussion every 30 seconds.

However, consider this scenario\:

An MDT is discussing adjuvant treatment for a patient with head-and-neck cancer. The team agrees on radiotherapy, but nobody mentions that the pathology report contains a positive surgical margin.

**Should the AI remain silent because nobody asked it a question?**

I would propose a hybrid approach\:

- **Before MDT\:** Proactively identify missing information, contradictions and guideline-relevant findings.
- **During MDT\:** Answer questions on demand, but silently update its understanding of the discussion.
- **Before finalizing the decision\:** Perform one structured safety and completeness check, which clinicians can review.

This preserves clinical autonomy without losing the value of an independent review.

### B. Is a guideline recommendation possible before the diagnostic pathway is complete?

This is where your GLIDE experience becomes particularly valuable.

Retrospective auditing asks: *Was the care provided consistent with the relevant guidelines?*

Prospective MDT support asks: *Given what we know right now, what can we reasonably recommend, and what must we establish first?*

These are fundamentally different tasks.

I would distinguish three states\:

**Sufficient information**

The available evidence supports presenting guideline-based treatment options.

**Conditional recommendation**

Several options remain possible depending on a missing result, such as a biomarker or staging investigation.

**Insufficient or conflicting evidence**

A reliable recommendation cannot yet be made. The assistant identifies what needs clarification and why.

Importantly, these states should apply to **individual clinical questions**, not necessarily to the whole patient. A case might be ready for discussion of local treatment but not for selecting systemic therapy.

### C. Do we really need to build the entire workflow today?

I agree that showing before, during and after MDT is the strongest narrative.

But we should not build three independent products.

Instead, **one shared, continuously updated patient representation should power all three stages.**

That is the architectural decision I would prioritize.

## 2\. Proposed architecture

**Clinical inputs**

Clinical notes · Pathology · Imaging · Laboratory results · Previous MDT decisions

**1\. Patient knowledge layer**

Structured facts · Timeline · Provenance · Conflicts · Unknowns

**2\. Clinical reasoning layer**

Guideline retrieval · Eligibility conditions · Missing-data assessment · Evidence comparison

All stages use the same patient state, updated with clinician-confirmed information.

### The most important technical principle: facts are not just strings

I wouldn't store the patient's clinical information as one large AI-generated summary.

Instead, each important clinical fact should have a structured representation, for example\:

```json
{
  "field": "p16_status",
  "value": "positive",
  "source": "pathology_report_03",
  "date": "2026-10-10",
  "status": "documented",
  "verified_by_clinician": false
}
```

Why? Because the system must distinguish\:

- A finding documented in an original report.
- A finding inferred by the AI.
- A finding mentioned verbally during MDT.
- A finding confirmed by a clinician.
- A finding that conflicts with another source.

These should never be treated as equally reliable.

I would also keep the **source date and clinical validity period**, since an older negative scan and a newer positive scan may reflect disease progression rather than a contradiction.

## 3\. What I would actually build for the hackathon

**Step 1 - Upload a synthetic patient record**

Include a clinical history, histology, imaging report, laboratory results and previous treatment documentation. The system extracts facts and builds a timeline.

**Step 2 - Generate the MDT briefing**

Display the diagnosis, current clinical status, reason for MDT, relevant findings and missing information. Add clickable source references.

**Step 3 - Show guideline-supported options**

Retrieve a small, curated set of guideline excerpts for one cancer type. Display relevant treatment pathways, the conditions for their applicability, and which conditions remain unknown.

**Step 4 - Simulate the live MDT**

Doctors discuss the case. Speech is transcribed, and the assistant extracts proposed decisions and newly mentioned information. A clinician can ask: "What do the guidelines say for this situation?"

**Step 5 - Produce a draft MDT conclusion**

The system prepares a structured record containing the discussed options, final clinician-selected plan, rationale, unresolved questions and next steps.

For a one-day prototype, I would use a narrow, curated guideline knowledge base rather than attempting to ingest every oncology guideline. Guideline version, applicability and exact supporting passages need to be visible.

Live transcription is an attractive demo feature, but I would make it replaceable with typed dialogue if audio integration becomes unreliable.

And because this is healthcare, the demo should use synthetic or properly de-identified records, with meeting participants' consent for recording. The clinical decision must remain with the MDT, not the AI.

## 4\. The feature that could differentiate us

I would call it **Decision Readiness**\.

Instead of saying\:

"Patient has incomplete documentation."

The assistant says\:

"Two guideline-supported pathways may be relevant. The choice depends on pathological risk factors. The supplied pathology report does not establish whether extranodal extension is present. Please clarify this before finalizing the adjuvant treatment decision."

That is a much more valuable contribution.

And it creates a powerful demonstration: **the AI doesn't merely know the guidelines; it knows what it doesn't know about this patient.**

## 5\. Four questions I need you to think about next

These will determine the actual implementation.

[Build our hackathon plan]

One last point: I would keep the distinction between **what the guidelines recommend, what the available patient data supports, and what the MDT ultimately decides** visible throughout the product.

That is where I think your GLIDE experience can genuinely make this project different from a generic medical AI chatbot.

## Prompt:
16/10/2026, 10:08:02

Which is why I am ultimately probably. It's better if you listen closely and change. Sorry? Isn't that a solution?

## Response:
16/10/2026, 10:08:03 · gpt-6

Sorry, I didn't quite catch what you meant. Are you suggesting that the AI should **listen closely to the MDT discussion and dynamically change its assessment and guideline-based suggestions** as new information emerges?

If so, yes — I think that could be one of the strongest features of our solution. But tell me what you had in mind; I don't want to put words in your mouth.

## Prompt:
16/10/2026, 10:14:04

![IMG_1267.jpeg](https://sdmntprindiasocentral.oaiusercontent.com/files/00000000-0734-8211-84e9-2600f76e3507/raw?se=2026-10-16T14%3A08%3A06Z&sp=r&sv=2026-02-06&sr=b&scid=7a134360-5643-40f4-a0cf-ab8d4a92dc7c&skoid=5c9dda00-298b-4376-81e9-b4568c8a3c0f&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2026-10-16T08%3A27%3A49Z&ske=2026-10-17T08%3A27%3A49Z&sks=b&skv=2026-02-06&sig=87UNwvwKBw3kTthFUWrlD8/keD50qWJRbxCPih%2BCDqE%3D)

this is what i meant

i dont want to go on demand anymore, i think there would be bias from doctors because theyre the experts, rather it should listen closely and then reassess the next steps for the specific patient

## Response:
16/10/2026, 10:14:06 · gpt-6

Yes\! **This changes the concept quite significantly, and I think it's a stronger direction.**

You're identifying a limitation of an on-demand assistant: **it can only challenge what clinicians choose to ask about.**

If the MDT collectively overlooks an important finding, nobody may think to ask the AI about it. And even highly experienced clinicians can be influenced by anchoring bias, confirmation bias, or groupthink.

What you're proposing is an **independent, proactive clinical reasoning layer** that continuously reassesses the patient as the MDT discussion unfolds.

## How I imagine it working

**Before MDT**

AI independently evaluates available patient data against relevant guidelines and prepares conditional treatment pathways.

**During MDT**

AI listens to the discussion, identifies new clinical facts and proposed decisions, and continuously reassesses its initial evaluation.

**Real-time clinical reassessment** (AI review)

**Potentially overlooked finding**

The proposed treatment may not account for a documented high-risk pathological feature.

---

**Missing information**

A clinically relevant result is unavailable. The assistant identifies what needs to be clarified before choosing between treatment pathways.

---

**Guideline consideration**

An alternative guideline-supported pathway may be relevant, with a citation and explanation of its applicability.

**After MDT**

AI documents the final clinician-approved decision, its rationale, unresolved questions and any justified departures from guidelines.

## One design decision I would insist on

**The AI should form its preliminary assessment before hearing the clinicians' proposed treatment.**

Otherwise, the AI itself risks becoming anchored to the MDT's initial opinion.

I'd build two distinct reasoning stages\:

1. **Independent assessment\:** Based on the documented patient facts and applicable guidelines, what treatment options are supported? What information is missing?
2. **MDT reassessment\:** Given the discussion, what genuinely new information emerged? Does it change the available options? Is the proposed decision consistent with the evidence?

Importantly, the second stage should not automatically accept something just because a senior clinician said it. A verbal statement should be recorded as a new claim until verified or confirmed.

And the AI should not interrupt every time it finds something. I'd distinguish critical issues requiring immediate attention from lower-priority considerations that can wait until the team is ready to finalize its decision.

## Here's the question I'd challenge you with next

Imagine an MDT discussing a patient with resected head-and-neck cancer. The clinicians agree on adjuvant radiotherapy alone.

The AI independently identifies a positive surgical margin in the pathology report and retrieves a relevant guideline passage supporting consideration of postoperative chemoradiotherapy in an appropriately eligible patient.

**What should the AI actually do?**

**A.** Immediately interrupt the discussion and alert the clinicians.

**B.** Display a prominent but silent alert with the supporting evidence.

**C.** Wait until the team proposes its final decision, then explicitly challenge it.

**D.** Combine B and C: flag the finding immediately, then require acknowledgment before finalizing the MDT record.

[Explore this design]

I lean toward **D**, with acknowledgment meaning that the team has considered the alert, not that it must follow the AI's suggestion.

That would give us something much more interesting than an AI assistant that simply agrees with experts: **a system designed to surface potentially overlooked evidence while keeping clinical decisions in human hands.**

## Prompt:
16/10/2026, 10:27:34

yes i agree

The AI should form its preliminary assessment before hearing the clinicians' proposed treatment.

## Response:
16/10/2026, 10:27:35 · gpt-6

Exactly. I think this should become one of the **core design principles of our MDT Copilot**\:

**Independent assessment first. Clinical discussion second. Continuous reassessment third.**

The key is that the AI shouldn't simply validate the clinicians' proposed treatment. It should have an independently established, evidence-based assessment against which the MDT discussion can be evaluated.

## How we should implement this

**1\. Pre-MDT independent assessment** (Baseline)

Before hearing the clinicians, the AI evaluates the available documentation and relevant guidelines.

Output: clinical facts, missing information, uncertainties, guideline-supported options and their eligibility criteria.

**2\. Live MDT observation**

The AI listens, identifies newly discussed facts, clinical reasoning and proposed treatment decisions.

Crucially, it preserves its original assessment rather than overwriting it.

**3\. Independent reassessment**

The AI evaluates whether new information genuinely changes the applicable guideline pathways or resolves previous uncertainty.

Output: updated assessment, remaining uncertainties and any potentially overlooked considerations.

**4\. Decision comparison**

The AI compares the proposed MDT decision with the independently established evidence and flags clinically relevant discrepancies.

The MDT can accept, reject or justify departing from the suggested pathways.

One important nuance: **an independent AI assessment is not necessarily an unbiased or correct assessment.** It can misinterpret documentation, overlook contraindications or retrieve inapplicable guidelines. That's why we should preserve source citations, distinguish confirmed facts from assumptions, and let clinicians challenge the AI's conclusions.

## One additional feature I'd introduce

**Decision evolution tracking.**

Imagine we could show how the assessment changes during the meeting\:

| Stage | Assessment |
|--------|--------|
| Before MDT | Two possible treatment pathways; biomarker status unknown |
| During MDT | Clinician confirms biomarker result |
| AI reassessment | One pathway becomes more relevant |
| MDT proposal | Team proposes a different treatment |
| AI review | Flags discrepancy and requests clinical rationale |
| Final decision | Clinician-approved plan with documented justification |

This could be a powerful demonstration because the judges would actually see the AI reasoning *evolve as new information becomes available*, rather than merely generating a static answer.

### My next question

Should the AI's **independent preliminary assessment be visible to clinicians before they start discussing the patient**, or should it remain hidden until they have formulated their initial proposal?

There's a fascinating trade-off here\:

- **Visible\:** Helps clinicians prepare, but could introduce automation bias and anchor the discussion.
- **Hidden\:** Preserves independent human and AI assessments, but sacrifices some of the preparation benefits.
- **Hybrid\:** Shows the factual patient summary and missing-information alerts beforehand, while withholding treatment suggestions until the MDT has expressed its initial opinion.

I would seriously consider the **hybrid approach**\. It could reduce anchoring in both directions while retaining the time-saving benefits of the assistant.

## Prompt:
16/10/2026, 10:29:25

let’s pause for a while and think about the barriers of an mdt, obstacles, how much it takes to prepare,… maybe also it can show a calendar with all the patients for the day, where clinicians can upload the data and what patients they want to discuss

## Response:
16/10/2026, 10:29:26 · gpt-6

I think this is exactly the right direction for the product. We're currently thinking about what AI can do *during* an MDT, but we haven't sufficiently explored **how an MDT actually works, where clinicians lose time, and why the process is inefficient in the first place.**

And your calendar idea is particularly interesting because it transforms the product from an AI assistant into an **MDT workflow platform**\.

Let's map the entire journey, from the moment a patient is referred to the MDT until the agreed treatment is actually initiated.

## 1\. Where are the bottlenecks in a typical oncology MDT?

**1\. Scheduling and patient registration**

Patients need to be added to an MDT agenda, often through emails, spreadsheets, hospital systems or informal communication.

Potential problems: late referrals, duplicate entries, unclear clinical questions, missing cases and last-minute changes.

---

**2\. Collecting and preparing patient information**

Someone needs to gather pathology, radiology, staging, comorbidities, previous treatment and other relevant findings.

Potential problems: fragmented documentation, manual copying, outdated findings, missing reports and duplicated work.

---

**3\. The actual MDT meeting**

Multiple specialists review the case, discuss options and agree on a treatment plan.

Potential problems: limited meeting time, variable preparation, incomplete information, dominance of senior voices, anchoring bias and unclear documentation of the rationale.

---

**4\. Documenting the MDT decision**

The conclusion needs to be recorded and communicated to the treating clinicians.

Potential problems: manual transcription, ambiguous recommendations, missing responsibilities and delays in documentation.

---

**5\. Implementing the decision**

The patient may need additional imaging, surgery, systemic treatment, radiotherapy or referral to another specialist.

Potential problems: recommendations are not translated into actionable tasks, delays go unnoticed and patients can be lost between departments.

Notice something important: **the MDT itself is only one part of the workflow.** Improving the meeting without improving preparation and follow-up may leave much of the inefficiency untouched.

## 2\. How much time does MDT preparation actually take?

I wouldn't invent a single average because it varies substantially by specialty, case complexity, availability of records and whether the patient is being discussed for the first time.

For our hackathon, we can model the workload and then validate the assumptions with clinicians from Ostrava.

## MDT workload calculator

Illustrative scenario — adjust assumptions to reflect your department.

Patients per MDT

> **Slider**
>
> Current value unavailable.
>
> **Range:** 5 to 40
>
> **Step:** 1

Preparation per patient **min**

> **Slider**
>
> Current value unavailable.
>
> **Range:** 3 to 30
>
> **Step:** 1

Discussion per patient **min**

> **Slider**
>
> Current value unavailable.
>
> **Range:** 2 to 15
>
> **Step:** 1

Hypothetical reduction in preparation time **%**

> **Slider**
>
> Current value unavailable.
>
> **Range:** 0 to 80
>
> **Step:** 5

---

Current total preparation

Estimated preparation saved

Total discussion time

Remaining preparation

These are assumptions, not measured savings. Preparation estimates represent total clinician time per patient, excluding parallel work and subsequent review of AI outputs.

This gives us a concrete hypothesis to test: can the AI reduce preparation time **without increasing errors or shifting the workload into verification?**

## 3\. Your calendar idea — an MDT workspace

I would design the homepage around the MDT schedule, not around a chatbot.

Here's an interactive mockup of what clinicians could see.

## MDT Workspace

Oncology · Multidisciplinary tumor board

Friday, 16 October 2026

patients scheduled

[Add]

- Agenda
- Patient review
Current selection unavailable.

The most important field when registering a patient may not actually be the diagnosis. It may be\:

**"What specific clinical decision do you need the MDT to make?"**

Because that determines what information the assistant needs to collect.

For example, initial treatment planning, postoperative adjuvant treatment, and suspected recurrence require different clinical inputs and different guideline pathways.

## 4\. We should also consider the obstacles to adopting our solution

Even a clinically impressive prototype can fail in practice if we overlook\:

- **Data access\:** Hospital information systems, pathology systems and PACS may not be interoperable. Manual uploading is reasonable for a prototype but could create more work in production.
- **Trust\:** Doctors need to verify the AI's findings without rereading every document from scratch.
- **Alert fatigue\:** Too many notifications during MDT could make discussions slower, not faster.
- **Clinical responsibility\:** The system must support decisions without obscuring who made and approved them.
- **Privacy and governance\:** Patient data, meeting recordings, access permissions and retention need appropriate safeguards. Depending on intended use, medical-device regulation may also become relevant.
- **Implementation\:** A recommendation is not the same as completed care. The platform needs to distinguish decisions, assigned actions and confirmed completion.

## 5\. Three questions I would ask clinicians in Ostrava today

Before coding, I'd try to get real answers to these\:

1. **Who currently prepares patients for MDT, and how long does it take per patient?** Is it a junior doctor, specialist, coordinator or several people?
2. **What most commonly prevents an MDT from making a definitive decision?** Missing imaging, incomplete pathology, absent biomarker results, insufficient clinical context, or something else?
3. **What happens after the MDT agrees on a plan?** Who records it, who arranges the next steps, and how does the team know whether they happened?

These answers could completely change which feature deserves priority.

My current product hypothesis would be\:

**An MDT workspace that organizes patients and clinical questions, prepares evidence-based case summaries, independently evaluates guideline-relevant information, proactively supports the discussion, and turns decisions into trackable clinical actions.**

But I want to ask you something more fundamental before we settle on that direction\:

**In your own clinical experience, what is the most frustrating part of MDTs?** Is it preparing patients, the quality of the discussion, missing information, time pressure, or what happens after the meeting?

I suspect your answer will tell us more about what to build than another hour of brainstorming AI features.

## Prompt:
16/10/2026, 11:54:32

![IMG_1291.jpeg](https://sdmntprnortheu.oaiusercontent.com/files/00000000-c410-81f4-8a1d-7207759964ff/raw?se=2026-10-16T14%3A08%3A06Z&sp=r&sv=2026-02-06&sr=b&scid=d6d4d481-7921-45c6-be10-8effb8470f4a&skoid=5c9dda00-298b-4376-81e9-b4568c8a3c0f&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2026-10-16T08%3A59%3A00Z&ske=2026-10-17T08%3A59%3A00Z&sks=b&skv=2026-02-06&sig=NrdeChKf548gozGobCdZ7qROJ%2BMpQyr6hopzsGLenOo%3D)

![IMG_1292.jpeg](https://sdmntprnortheu.oaiusercontent.com/files/00000000-8734-81f4-8ae1-65d646cfb6a5/raw?se=2026-10-16T14%3A08%3A06Z&sp=r&sv=2026-02-06&sr=b&scid=d87576f5-c839-4ea3-8f99-655f5dca4355&skoid=5c9dda00-298b-4376-81e9-b4568c8a3c0f&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2026-10-16T03%3A57%3A40Z&ske=2026-10-17T03%3A57%3A40Z&sks=b&skv=2026-02-06&sig=O4U9u1JmtX1hDVWB3pmwirMsGyG7p3LkhFD2IiJBZIw%3D)

aby to bralo latest dáta 

porovnanie zobraziek staré 

aby to niekde zaznamenalo kto tam je prítomný

## Response:
16/10/2026, 11:54:34 · gpt-6

Toto sú veľmi dôležité informácie priamo od zadávateľa z FN Ostrava. A myslím si, že nám pomáhajú presnejšie definovať, **čo má náš MDT Copilot reálne riešiť**\.

Z prezentácie vyplýva, že lekár dnes manuálne vyhľadáva, číta, porovnáva, chronologicky usporadúva a kontroluje údaje z NIS, LIS, PACS, patológie a genetického laboratória.

K tomu by som doplnila tvoje tri požiadavky\:

1. **Latest available data** – asistent musí pracovať s najnovšími dostupnými výsledkami, nielen s dokumentmi nahratými pri registrácii pacienta na MDT.
2. **Longitudinal imaging comparison** – musí vedieť porovnať predchádzajúce a aktuálne zobrazovacie nálezy a identifikovať progresiu, regresiu alebo stabilizáciu ochorenia.
3. **MDT attendance tracking** – musí zaznamenať, ktorí odborníci boli na zasadnutí prítomní a kto sa podieľal na rozhodnutí.

## Ako by som tieto funkcie navrhla

## MDT Copilot

Friday, 16 October · Oncology MDT

(Data checked)

**Patient ONC-002** (Scheduled 11:30)

Pathology report available

Latest laboratory results checked

New CT report since previous MDT

Illustrative interface; statuses are simulated.

**Imaging evolution**

Previous CT

**12 Aug 2026**

Target lesion: 32 mm

Latest CT

**10 Oct 2026**

Target lesion: 21 mm

Illustrative decrease in lesion diameter: 34.4%

A change in one lesion's diameter is not sufficient to assign an overall RECIST response category.

---

**MDT attendance**

of  roles marked present [Copy]

## Niekoľko dôležitých detailov, ktoré by sme nemali prehliadnuť

**Pri najnovších dátach\:** Musíme odlišovať dátum vyšetrenia, dátum vydania nálezu a dátum, keď sa výsledok dostal do systému. Napríklad včerajšie CT môže mať definitívny popis až dnes. Asistent by mal vedieť oznámiť, že pribudol nový nález, a znovu vyhodnotiť jeho vplyv na pripravené MDT podklady.

Zároveň „najnovšie“ nemusí znamenať „najrelevantnejšie“. Pri rozhodovaní o adjuvantnej liečbe môže byť starší definitívny histologický nález dôležitejší než novšia ambulantná správa.

**Pri zobrazovacích vyšetreniach\:** Na hackathone by som začala porovnávaním rádiologických správ, nie priamou AI interpretáciou DICOM snímok. To je výrazne realizovateľnejšie. Asistent môže extrahovať rozmery lézií, nové metastázy a opis dynamiky, ale musí upozorniť, keď merania nie sú porovnateľné alebo chýbajú.

**Pri dochádzke\:** Nestačí zaznamenať len špecializácie. Potrebujeme konkrétne osoby, ich roly, čas účasti a ideálne aj informáciu, kto schválil konečný záver. To je dôležité pre auditovateľnosť MDT.

## A teraz dve otázky, ktoré by som položila zadávateľovi

**1\. Bude mať náš asistent priamy prístup k NIS, LIS, PACS a ďalším systémom, alebo sa počíta s manuálnym nahrávaním dokumentov?**

Toto zásadne ovplyvňuje možnosť garantovať, že AI pracuje s aktuálnymi dátami. Bez integrácie môžeme garantovať iba aktuálnosť vzhľadom na posledný import.

**2\. Má byť výsledkom MDT automaticky vytvorený zápis, ktorý obsahuje aj prítomných odborníkov, rozhodnutie, jeho odôvodnenie a konkrétne ďalšie kroky?**

Pretože ak áno, získavame veľmi pekne prepojený workflow\:

**MDT kalendár → automatická príprava → kontrola najnovších výsledkov → živá diskusia s AI → schválený zápis → sledovanie ďalších krokov.**

A ešte by som sa chcela vrátiť k jednej veci z našej predchádzajúcej diskusie: ak počas MDT pribudne nový výsledok, asistent by mal aktualizovať svoje pôvodné nezávislé hodnotenie a jasne ukázať, **čo sa zmenilo a prečo**\. To by podľa mňa mohol byť najsilnejší moment našej hackathon prezentácie.

## Prompt:
16/10/2026, 12:14:28

dneska budeme pracovať s dátami neuroonko tímu, dostaneme mock dokumentáciu a následne ako má vyzerať MDT protokol

## Response:
16/10/2026, 12:14:29 · gpt-6

Perfektné, toto nám výrazne pomôže zúžiť scope hackathonu. **Neuroonkologické MDT + mock zdravotná dokumentácia + vzor finálneho MDT protokolu** je veľmi dobrý základ na vytvorenie funkčného prototypu.

A hlavne už máme jasne definovaný vstup aj požadovaný výstup.

## Ako by som dnes postupovala

**1\. Vstup: Mock dokumentácia pacienta**

Načítame všetky dostupné dokumenty, extrahujeme klinicky relevantné informácie, chronológiu ochorenia, histológiu, molekulárne markery, predchádzajúcu liečbu a výsledky MRI.

**2\. Pred MDT: Nezávislé AI hodnotenie**

AI vytvorí klinické zhrnutie, identifikuje chýbajúce či protichodné informácie a podľa dostupných guidelines pripraví možné ďalšie diagnostické alebo terapeutické postupy.

Toto hodnotenie uložíme ako samostatnú verziu ešte pred diskusiou.

**3\. Počas MDT: Aktívny AI copilot**

AI sleduje simulovanú diskusiu, zachytáva nové informácie, porovnáva návrhy lekárov s nezávislým hodnotením a upozorňuje na relevantné rozpory alebo prehliadnuté skutočnosti.

**4\. Po MDT: Automatický protokol**

Na základe diskusie vytvoríme návrh MDT protokolu presne podľa šablóny FN Ostrava, vrátane prítomných lekárov, klinického záveru, rozhodnutia a ďalších krokov. Finálnu verziu schváli lekár.

## Čo je špecifické pre neuroonkológiu?

Tu by som si dala pozor najmä na tieto oblasti\:

| Oblasť | Čo má AI sledovať |
|--------|--------|
| Histológia a molekulárna diagnostika | Integrovaná WHO diagnóza, IDH, 1p/19q, MGMT, prípadne ďalšie markery podľa typu nádoru |
| MRI | Lokalizácia, rozsah, kontrastné sýtenie, edém, porovnanie s predchádzajúcimi vyšetreniami |
| Predchádzajúca liečba | Operácia, rozsah resekcie, RT, systémová liečba, dávky a časové intervaly |
| Klinický stav | KPS/ECOG, neurologický deficit, epileptické záchvaty, kortikoterapia |
| Hodnotenie odpovede | RANO kritériá podľa diagnózy a klinického kontextu, pseudoprogresia vs. progresia |
| Rozhodnutie MDT | Indikácia operácie, RT, systémovej liečby, sledovania či ďalšej diagnostiky |

Dôležité: nie každý neuroonkologický pacient potrebuje všetky tieto údaje. **Požiadavky na dokumentáciu by sa mali meniť podľa diagnózy a konkrétnej otázky pre MDT.**

## Čo by som spravila hneď, keď dostanete podklady

Najskôr by som analyzovala vzor MDT protokolu a vytvorila z neho presnú výstupnú dátovú štruktúru. Potom by sme spätne zmapovali, ktoré údaje potrebujeme z jednotlivých dokumentov a ktoré musia vzniknúť až počas zasadnutia.

Takto sa vyhneme tomu, že vyvinieme pekné AI zhrnutie, ktoré však nebude obsahovať informácie potrebné pre reálny protokol.

A odporúčam pripraviť jeden veľmi konkrétny demo moment: **AI dostane novší MRI nález, ktorý mení pôvodné klinické hodnotenie, aktualizuje svoje možnosti a počas MDT upozorní na relevantnú zmenu.** Ideálne bez toho, aby si vymyslela informácie, ktoré v dokumentácii nie sú.

### Zatiaľ mám jednu zásadnú otázku\:

**Dostanete len dokumentáciu jedného neuroonkologického pacienta, alebo viacero pacientov?**

Ak viacerých, môžeme vytvoriť aj tvoj pôvodný nápad s MDT kalendárom, zoznamom pacientov, stavom pripravenosti a individuálnym AI briefingom pre každého z nich. Ak len jedného, prioritizovala by som kvalitu klinického spracovania, nezávislé hodnotenie a automatické vytvorenie protokolu.

## Prompt:
16/10/2026, 12:15:27

myslím, že to zadanie je len pre sumarizáciu prípadov, a teda to orovnanie voči guidelines je nadstavba

## Response:
16/10/2026, 12:15:28 · gpt-6

Áno, súhlasím. A myslím si, že by sme mali **striktne oddeliť to, čo požaduje FN Ostrava, od našej vlastnej vízie produktu**\. Inak riskujeme, že na hackathone budeme riešiť príliš veľa problémov naraz.

Zadanie je primárne o **automatizácii prípravy podkladov pre MDT**, nie o klinickom decision supporte.

## Navrhovala by som tri úrovne produktu

**1\. Core MVP — zadanie hackathonu** (Priorita)

Cieľ: Z dostupnej zdravotnej dokumentácie automaticky vytvoriť kvalitný, štruktúrovaný podklad pre neuroonkologické MDT.

- Extrakcia relevantných údajov z dokumentácie.
- Chronologické usporiadanie diagnostiky a liečby.
- Porovnanie starších a novších MRI nálezov.
- Identifikácia chýbajúcich a protichodných informácií.
- Zohľadnenie najnovších dostupných výsledkov.
- Generovanie výstupu podľa vzoru MDT protokolu.
- Odkazy na pôvodné zdroje, aby si lekár mohol údaje overiť.

Toto by malo byť funkčné a spoľahlivé predtým, než pridáme čokoľvek ďalšie.

**2\. Workflow — používateľská nadstavba** (Ak zostane čas)

- Kalendár MDT so zoznamom pacientov.
- Pridávanie pacientov a nahrávanie dokumentácie.
- Stav pripravenosti jednotlivých prípadov.
- Evidencia prítomných lekárov.
- Záznam záverov MDT a ich schválenie.

Toto je podľa mňa veľmi dobrá vrstva na prezentáciu produktu, ale nemusíme dnes vyvíjať všetko.

**3\. Clinical intelligence — naša vízia** (Future roadmap)

- Nezávislé posúdenie prípadu podľa aktuálnych guidelines.
- Identifikácia možných diagnostických a terapeutických postupov.
- Aktívne sledovanie MDT diskusie.
- Upozorňovanie na potenciálne prehliadnuté klinické informácie.
- Porovnanie rozhodnutia MDT s relevantnými odporúčaniami.

Toto by som dnes predstavila ako budúci potenciál, nie ako základnú funkcionalitu.

## Čo by som chcela ukázať porote

Predstav si jednoduchý scenár\:

**Vstup**

15 rôznych dokumentov jedného neuroonkologického pacienta: ambulantné správy, MRI nálezy, histológia, operačný protokol, laboratórne výsledky.

**AI spracovanie**

Extrakcia údajov, chronológia, porovnanie nálezov, identifikácia rozporov a kontrola úplnosti.

**Výstup**

Hotový návrh MDT podkladu podľa šablóny nemocnice, ktorý lekár skontroluje a môže použiť na zasadnutí.

A tu by som pridala jednu veľmi dôležitú vec: **pred MDT nemôžeme automaticky vygenerovať definitívny MDT záver.** Ten ešte neexistuje. Preto by sme mali mať dva odlišné dokumenty\:

- **Pre-MDT briefing\:** všetko, čo o pacientovi vieme, a otázka, ktorú má MDT vyriešiť.
- **Post-MDT protokol\:** briefing doplnený o prítomných odborníkov, výsledok diskusie, rozhodnutie a ďalší postup.

Aj keď nemocnica poskytne len jednu šablónu, interne by som tieto dve fázy oddelila.

## A čo by som považovala za skutočný úspech?

Nie to, že LLM vygeneruje pekný text.

Ale že **lekár dokáže rýchlejšie pripraviť pacienta na MDT, pričom sa nestratia žiadne zásadné informácie a všetky údaje sú overiteľné.**

Preto by som už dnes merala tri veci: čas potrebný na prípravu, správnosť a úplnosť extrahovaných klinických údajov a počet nesprávne identifikovaných či prehliadnutých rozporov.

Keď dostanete mock dokumentáciu a vzor MDT protokolu, pošli mi ich. Najprv by som ich porovnala a urobila **mapu vstupných údajov → požadovaných polí protokolu → extrakčných pravidiel**\. To bude podľa mňa najlepší základ pre developerov.

## Prompt:
16/10/2026, 12:16:26

takže potrebujeme tú summary a potom po MDT aby to počúvalo a urobilo záver a next steps.. a kto to potvrdil a modul s guidelines bude tam tiež ale môžu a nemusia to ľudia používať? ale ja to tam riadne chcem

## Response:
16/10/2026, 12:16:27 · gpt-6

Áno\! A myslím si, že **guidelines modul by sme tam určite mali mať**, len ho musíme navrhnúť tak, aby nekomplikoval základný workflow a zároveň nebol iba nejakou dekoratívnou funkciou.

Ja by som produkt postavila na **troch vzájomne prepojených moduloch**, pričom prvé dva riešia priamo zadanie FN Ostrava a tretí je naša inovácia.

## Architektúra MDT Copilot

**1\. PRE-MDT**

(Core)

## Intelligent patient summary

Automaticky spracuje dostupnú dokumentáciu a vytvorí štruktúrovaný klinický prehľad.

- Diagnóza, histológia, molekulárne markery, klinický stav.
- Chronologická os diagnostiky a liečby.
- Porovnanie aktuálnych a predchádzajúcich MRI nálezov.
- Najnovšie dostupné výsledky.
- Chýbajúce informácie a rozpory.
- Odkazy na zdrojové dokumenty.

**Výstup\:** Podklady pre MDT, pripravené na kontrolu lekárom.

**2\. LIVE MDT &amp; POST-MDT**

(Core)

## Discussion capture &amp; decision documentation

Počas zasadnutia asistent so súhlasom účastníkov zaznamenáva diskusiu a vytvára návrh záveru.

- Rozpozná diskutované klinické možnosti.
- Zachytí nové informácie o pacientovi.
- Identifikuje výsledné rozhodnutie MDT.
- Vytvorí konkrétne next steps vrátane zodpovedností a termínov, ak boli určené.
- Eviduje prítomných lekárov.
- Umožní potvrdenie finálneho protokolu oprávneným lekárom.

**Výstup\:** Schválený MDT protokol a zoznam ďalších krokov.

**3\. GUIDELINES INTELLIGENCE**

(Voliteľný)

## Independent clinical evidence review

Modul nezávisle vyhodnotí dostupné údaje pacienta voči relevantným odporúčaniam.

- Pripraví guideline-supported možnosti ešte pred MDT.
- Identifikuje chýbajúce údaje potrebné na rozhodnutie.
- Zobrazí konkrétne odporúčania a ich zdroje.
- Počas diskusie môže prehodnotiť možnosti na základe nových informácií.
- Upozorní na potenciálne prehliadnuté relevantné odporúčania.

**Výstup\:** Samostatný evidence panel, nie automatické rozhodnutie o liečbe.

## Ako zabezpečiť, aby guidelines modul bol skutočne užitočný?

Navrhovala by som, aby fungoval v dvoch režimoch\:

**Guidelines intelligence** 

- Off
- Active
Current selection unavailable.

**Ale pozor na jednu vec\:** Ak modul vypneme, nemali by sme prezentovať výsledok ako guideline-validated. A ak ho zapneme, musí jasne uvádzať, ktoré odporúčania používa, ich verziu a či má dostatok údajov na posúdenie.

## Čo by som dnes reálne prioritizovala

| Funkcia | Priorita |
|--------|--------|
| Patient summary z mock dokumentácie | P0 – musí fungovať |
| Chronológia a porovnanie MRI správ | P0 |
| Missing information &amp; contradictions | P0 |
| Generovanie MDT protokolu | P0 |
| Attendance + potvrdenie záveru | P0 |
| Guidelines panel s citáciami | P1 – veľmi žiaduce |
| Live transcription | P1 – ak funguje spoľahlivo |
| Proaktívne guideline upozornenia počas diskusie | P2 – nadstavba |
| Kalendár a správa pacientov | P2 – stačí jednoduché UI |

Ja by som dokonca guidelines panel ukázala už v dnešnom deme, ale v obmedzenom rozsahu: **jeden neuroonkologický scenár, jeden overený súbor odporúčaní a transparentné zdroje**\. To bude presvedčivejšie než generický chatbot, ktorý tvrdí, že pozná všetky guidelines.

A ešte by som rozlišovala medzi tým, že modul je *voliteľný pre používateľa*, a tým, že je *voliteľný pre produkt*\. Pre našu víziu môže byť jednou z hlavných konkurenčných výhod, aj keď ho nemocnica nemusí zapnúť pri každom zasadnutí.

**Moja otázka teraz\:** Chceš, aby guidelines modul bol iba samostatná záložka, do ktorej lekár môže vstúpiť, alebo aby **vždy pripravil nezávislé hodnotenie na pozadí, ale lekári si sami vybrali, či ho chcú počas MDT zobraziť a používať?**

Ja by som sa prikláňala k druhej možnosti, pokiaľ je to transparentné, klinicky overené a nemocnica má tento režim povolený.

## Prompt:
16/10/2026, 12:27:01

![IMG_1294.jpeg](https://sdmntprnortheu.oaiusercontent.com/files/00000000-592c-81f4-970d-c6cc7e1ca438/raw?se=2026-10-16T14%3A08%3A06Z&sp=r&sv=2026-02-06&sr=b&scid=1e981eb2-af0e-4f57-8029-b5b3babd60e1&skoid=5c9dda00-298b-4376-81e9-b4568c8a3c0f&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2026-10-16T07%3A43%3A04Z&ske=2026-10-17T07%3A43%3A04Z&sks=b&skv=2026-02-06&sig=tNnd2%2B5IkVJfgO1r3fXdPrCJZHKgd2%2BUTGAitr890g0%3D)

![IMG_1293.jpeg](https://sdmntprukwest.oaiusercontent.com/files/00000000-4f04-8243-8228-0d02e5a22607/raw?se=2026-10-16T14%3A08%3A06Z&sp=r&sv=2026-02-06&sr=b&scid=e0abd9b1-e792-4dab-a4a0-98b39fdbe22f&skoid=5c9dda00-298b-4376-81e9-b4568c8a3c0f&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2026-10-16T02%3A05%3A16Z&ske=2026-10-17T02%3A05%3A16Z&sks=b&skv=2026-02-06&sig=pPOge7ur61Bc8Qo1VXH7/Jca5m%2BB0JXVZf%2B4TlJgvEQ%3D)

## Response:
16/10/2026, 12:27:03 · gpt-6

Toto je veľmi užitočné\! Teraz už máme **konkrétne očakávania FN Ostrava**, a čo je najlepšie, náš koncept s nimi veľmi dobre zapadá.

Z prezentácie vyplýva, že zadávateľ chce dva hlavné výstupy\:

## 1\. Prezentačná aplikácia pre MDT

Interaktívne prostredie, v ktorom sa bude pacient prezentovať a diskutovať.

Požadované funkcie\:

- Stručné klinické zhrnutie prípadu.
- Interaktívny, schematický prehľad pacienta.
- Rozklikávacie informácie (klinický nález, histológia atď.).
- Časová os diagnostiky a liečby.
- Preklik na detailnejšie informácie.

Tu by som pridala náš **Missing Information &amp; Contradictions panel**, ktorý upozorní na neúplné alebo nejednoznačné údaje.

## 2\. Report pre zdravotnícku dokumentáciu

Druhý výstup je dokument, ktorý môže nemocnica použiť v zdravotnej dokumentácii alebo pri plánovaní ďalších vyšetrení a liečby.

Zadávateľ očakáva\:

- Informácie vybrané z prezentačnej aplikácie.
- Automaticky vytvorený PDF dokument.
- Možnosť vytvoriť žiadosti o ďalšie vyšetrenie alebo liečbu.

Tu by som integrovala náš **Post-MDT Copilot**\:

Počas diskusie by AI zaznamenávala nové informácie, závery a ďalšie kroky. Po skončení by vytvorila návrh protokolu, ktorý lekár skontroluje a potvrdí.

Dôležité je, aby AI neprezentovala návrh ako schválené rozhodnutie, kým ho oprávnený lekár skutočne nepotvrdí.

## 3\. Formulár na zaradenie pacienta do MDT

Druhý slide nám ukazuje, aké údaje sa dnes zbierajú\:

| Sekcia | Údaje |
|--------|--------|
| Identifikácia | Meno, rodné číslo, poisťovňa |
| Informácie o pacientovi | Anamnéza, zobrazovacie vyšetrenia, aktuálny klinický stav |
| Odosielateľ | Lekár, pracovisko, e-mail, telefón |
| Prílohy | PDF, DOCX, DOC, ZIP, XLS, XLSX, ODT; max. 20 MB |
| Klinická otázka | Otázka alebo požiadavka na NOCO |
| Súhlas | Spracovanie osobných údajov |

Toto by som využila ako základ pre **registráciu pacienta do MDT kalendára**\.

Po vyplnení formulára a nahratí dokumentácie sa pacient automaticky objaví v zozname prípadov na príslušné MDT.

## 4\. Ako by som teraz definovala náš produkt

**MDT Agenda**

Registrácia pacientov, termíny, dokumentácia, pripravenosť prípadu.

---

**AI Patient Briefing**

Klinické zhrnutie, časová os, porovnanie nálezov, chýbajúce údaje.

---

**Guidelines Intelligence**

Voliteľné nezávislé posúdenie prípadu podľa odporúčaných postupov.

---

**Live MDT Copilot**

Záznam diskusie, nových informácií a výsledného rozhodnutia.

---

**MDT Report &amp; Next Steps**

Návrh protokolu, prítomní lekári, schválenie, PDF a ďalšie úlohy.

## Čo by som teraz rozhodne nemenila

Tvoj nápad s guidelines modulom by som zachovala. Je to niečo, čo zadávateľ výslovne nepožaduje, ale môže to byť najzaujímavejšia inovácia.

Zároveň by som ho oddelila od automatického generovania dokumentácie. **Guideline-supported treatment options nie sú automaticky záverom MDT.** Záver musí odrážať skutočné rozhodnutie tímu.

Pre hackathon by som prioritizovala funkčnú prezentačnú aplikáciu a export protokolu. Live listening a guidelines by som ukázala ako integrované rozšírenia, pokiaľ ich stihnete spoľahlivo implementovať.

**Jedna vec, ktorú by som teraz potrebovala vedieť\:** Máte už k dispozícii aj konkrétnu mock dokumentáciu neuroonkologického pacienta, alebo zatiaľ iba tieto slidy?

Keď ju dostanete, môžeme prejsť od brainstormingu k presnému návrhu obrazoviek, extrakčných polí a workflow pre developerov.

## Prompt:
16/10/2026, 14:00:49

Ako má vyzerať summary: 
anamnéza
onkologický súhrn 
kto je prítomní na MDT
aký je dotaz pre MDT

a priestor doplniť záver

## Response:
16/10/2026, 14:00:50 · gpt-6

Super, toto je teda **finálna požadovaná štruktúra MDT summary podľa zadávateľa**\. Navrhla by som ju ako jeden prehľadný dokument, ktorý sa pripraví pred MDT a doplní počas zasadnutia.

## MDT Patient Summary – návrh štruktúry

## Neuroonkologické MDT

Konzultácia pacienta · FN Ostrava

(Príprava)

---

01 / ANAMNÉZA

Relevantná osobná anamnéza, komorbidity, neurologické príznaky, výkonnostný stav, aktuálna medikácia a ďalšie informácie dôležité pre rozhodovanie.

---

02 / ONKOLOGICKÝ SÚHRN

Diagnóza, histológia a molekulárne markery, chronologický priebeh ochorenia, operačné výkony, RT, systémová liečba, aktuálne a predchádzajúce MRI nálezy, súčasný stav.

---

03 / PRÍTOMNÍ NA MDT

Mená a špecializácie zúčastnených odborníkov.

[Textarea placeholder: Meno, špecializácia\.\.\.] (Current value unavailable.)

---

04 / DOTAZ PRE MDT

Konkrétna klinická otázka, ktorú má tím zodpovedať.

[Textarea placeholder: Aký ďalší diagnostický alebo terapeutický postup zvoliť?] (Current value unavailable.)

---

05 / ZÁVER MDT (Doplní sa po diskusii)

[Textarea placeholder: Rozhodnutie MDT, odôvodnenie, ďalší postup, zodpovedný lekár a termíny\.\.\.] (Current value unavailable.)

[Kopírovať vyplnené údaje]

### Ako by mala fungovať automatizácia

**Pred MDT** AI vygeneruje anamnézu a onkologický súhrn z dokumentácie. Dotaz pre MDT prevezme z registračného formulára a prítomných lekárov načíta zo zoznamu účastníkov alebo umožní ich doplnenie.

**Počas MDT** sa do poslednej sekcie doplní záver – buď manuálne, alebo ako AI návrh zo zaznamenanej diskusie.

**Po MDT** oprávnený lekár záver skontroluje, potvrdí a exportuje sa finálny protokol do PDF.

Ja by som navyše do rozhrania pridala nenápadný panel **„Chýbajúce údaje / rozpory“**, ale nedávala ho automaticky do finálneho protokolu. Rovnako by som ponechala guidelines ako voliteľnú samostatnú záložku, aby sme zachovali presne tú štruktúru, ktorú zadávateľ požaduje.

**Dôležitý detail\:** Anamnéza a onkologický súhrn by mali byť stručné, ale každá zásadná informácia musí byť dohľadateľná v pôvodnej dokumentácii. Ak údaj chýba, AI ho nesmie doplniť odhadom.

## Prompt:
16/10/2026, 14:02:24

to je výstup

a predtým by mala byť obrazovka niečo ako databáza, kde sa môže pridať nový pacient 
(plus je kalendár, kam toho pacienta rovno zadám na konkrétny deň)

## Response:
16/10/2026, 14:02:25 · gpt-6

Presne\! Takže **MDT summary je až výsledný dokument**, ale pred ním potrebujeme aplikáciu, v ktorej sa spravujú pacienti, ich dokumentácia a termíny MDT.

Navrhla by som aplikáciu ako **MDT Workspace** s tromi hlavnými obrazovkami.

## 1\. Patient Database – úvodná obrazovka

Toto by bola hlavná obrazovka po prihlásení. Lekár vidí všetkých pacientov, môže ich vyhľadávať, pridávať nových a otvárať ich dokumentáciu.

# MDT Workspace

Neuroonkologický tím · FN Ostrava

[Pacienti] [Kalendár]

Interaktívny koncept rozhrania so syntetickými pacientmi. Údaje sa v tejto ukážke neukladajú do nemocničného systému.

## 2\. Patient Detail – príprava prípadu

Po kliknutí na pacienta sa otvorí jeho profil. Tu by mal lekár vedieť nahrať dokumentáciu, pozrieť si dostupné výsledky, skontrolovať dátum poslednej aktualizácie a spustiť AI spracovanie.

Dôležité: **pacienta by sme mali vedieť založiť aj bez okamžitého zaradenia na MDT**\. Jeden pacient sa totiž môže na MDT vracať opakovane. Databáza pacientov a kalendár zasadnutí by preto mali byť dve prepojené, ale samostatné entity.

## 3\. MDT Session – samotné zasadnutie

Keď lekár otvorí konkrétny termín v kalendári, zobrazí sa zoznam pacientov určených na diskusiu. Po otvorení pacienta uvidí AI summary v požadovanej štruktúre\:

**Anamnéza → Onkologický súhrn → Prítomní → Dotaz pre MDT → Záver.**

Počas zasadnutia sa doplní záver a next steps, prípadne pomocou transkripcie. Následne oprávnený lekár protokol potvrdí a exportuje.

Guidelines modul by som umiestnila ako samostatný panel priamo vedľa summary. Bude tak dostupný bez toho, aby narúšal štandardný proces.

---

**Z pohľadu vývoja by som teda navrhla tento hlavný tok\:**

`Databáza pacientov → Nový pacient → Dokumentácia → Zaradenie do kalendára → AI summary → MDT zasadnutie → Záver a schválenie → PDF`

A jednu vec by som chcela rozhodnúť ešte pred tým, než začnete implementovať databázu: **má mať každý pacient jeden priebežne aktualizovaný profil a viacero historických MDT zasadnutí?**

Ja by som jednoznačne povedala áno. Umožní nám to sledovať vývoj ochorenia a predchádzajúce rozhodnutia bez toho, aby sme pri každom ďalšom MDT zakladali pacienta nanovo.

## Prompt:
16/10/2026, 14:04:13

možno k tomu aj nejaký filter či už boli rpeznetovaní na MDT a sú done alebo nie
a potom k tomu nejaký filter

## Response:
16/10/2026, 14:04:16 · gpt-6

Áno\! Pridala by som **status pacienta v MDT workflow** a možnosť filtrovať databázu podľa toho, v akej fáze sa jeho prípad nachádza.

Dôležité je rozlišovať, či bol pacient **prezentovaný na MDT**, a či je jeho prípad **administratívne uzavretý**\. To totiž nie je vždy to isté.

## Navrhované statusy

(New) Pacient je založený, ale ešte nie je zaradený na MDT.

(Scheduled) Pacient je naplánovaný na konkrétne zasadnutie.

(Needs preparation) Chýba dokumentácia alebo treba skontrolovať AI summary.

(Ready for MDT) Podklady sú pripravené na prezentáciu.

(Presented) Pacient bol prerokovaný, ale protokol ešte nie je potvrdený.

(Done) MDT záver je potvrdený a protokol uzavretý.

## Ako by vyzerali filtre v databáze?

## Patient Database

Neuro-oncology · MDT Workspace

[Add patient]

All patients

# 5

Pending

# 4

Done

# 1

[Input placeholder: Search patients or diagnoses\.\.\.] (Current value unavailable.)

Workflow status

MDT date

- All dates
- 16 Oct 2026
- 23 Oct 2026
Current selection unavailable.

---

**Patients**  results

Interaktívna ukážka so syntetickými údajmi.

## Ešte by som pridala tieto filtre

Okrem statusu a dátumu MDT by sa hodilo filtrovať podľa diagnózy, odosielajúceho pracoviska, zodpovedného lekára a toho, či pacientovi chýbajú dokumenty alebo má nevyriešené upozornenia.

**Jedna zásadná architektonická vec\:** Status *Done* by som priradila ku konkrétnej MDT konzultácii, nie natrvalo k pacientovi. Ten istý pacient môže byť prezentovaný opakovane, napríklad pri primárnej diagnóze a neskôr pri progresii. V databáze preto môže mať jednu uzavretú konzultáciu a ďalšiu naplánovanú.

A pre používateľa by som ponechala veľmi jednoduché hlavné filtre: **All / Upcoming / Needs attention / Presented / Done**\. Podrobnejšie filtre by boli schované pod „Advanced filters“, aby aplikácia nepôsobila komplikovane.

## Prompt:
16/10/2026, 14:08:46

Presented
Pacient bol prerokovaný, ale protokol ešte nie je potvrdený.

Done
MDT záver je potvrdený a protokol uzavretý.

these two almost same

## Response:
16/10/2026, 14:08:48 · gpt-6

Exactly. I would **merge Presented and Done into one status: Completed**\. There's no need to complicate the workflow with two nearly identical states.

I'd simplify the statuses to\:

| Status | Meaning |
|--------|--------|
| **New** | Patient added to the database, not yet scheduled. |
| **Scheduled** | Patient assigned to an upcoming MDT. |
| **Needs attention** | Documentation incomplete or AI summary requires review. |
| **Ready** | Patient prepared for MDT discussion. |
| **Completed** | Patient discussed at MDT and conclusion recorded. |

The distinction between an unconfirmed and confirmed protocol can exist **inside the patient's record** as `Draft / Approved`, rather than being a separate patient status.

One important exception: if a patient was discussed but no definitive decision was reached, I'd mark the consultation as **Follow-up required**, so the case doesn't disappear among completed cases.

For the main database, I'd use just four filter tabs\:

**All &#124; Upcoming &#124; Needs attention &#124; Completed**

This keeps the interface intuitive while preserving more detailed statuses internally.

## Prompt:
16/10/2026, 14:33:24

asi tam môže byť kolonka v databáze, kto je ownerom tohto pacienta, a odkiaľ prišiel

kto je prítomný : urobila by som špecializácie, ktoré by mali byť prítomné na mieste a pre dané pracovisko doplniť MUDr X, MUDr Y pre každú špecializáciu a bude to multiple choice kto tam je v daný deň prítomný

eg. anamnézy, aby mala všetky tieto zložky, aby ideálne ak možné boli tam časové údaje k osobnej anamnézy, či mal niekto v rodine onko ochorenie, aké, prípadne iné ochorenia, k pracovní či placuje, čo robí alebo či je v dôchode, sociální, kde žije a s kým, farmakologická aké lieky aká dávka, ako často sa užívajú, aké má alergie, aké má abusy, pri fajčení koľko cigariet denne od akého veku, rpepočítané na balíčkoroku, epidemiologická či je očkovaný na covid, chrípku, a pod., možno kľudne aj záložka preventivní vyštření, či chodí na vyšetrenia a dtáumy screeningov posledných gynekologického, kožní, urologické, plicni (ak applicable)..
**Anamnéza pacienta:&#xA0;**
**Osobní:** Bronchogenní karcinom pravého horního laloku, adenoca, T3N2-3M1c (krční lu)  IV. st., EGFR wt, ALK neg, ROS1 neg, PD-L1 90%
 - monoterapie pembrolizumab celkem 35 cyklů
 - resekce postižené krční uzliny 2024
 - dle ct hrudníku 16.6.2026 ve srovnání s CT vyš. z 19.11.2025 nově vícečetná ložiska v plicním parenchymu bilat., největší v S1/2 vlevo
 - Dle MDT indikován k AR lořiska LDL
CHOPN
Repozie čelisti spodní -2015
**Rodinná:** matka + na plicní onemocnění, otec+ na jaterní onemocnění
**Pracovní:** řidič, udržba na uřadě
**Sociální:** bydlí s rodinou
**Farmakologická**: Trimbow 87/5/9mcg ing p.o. 2-0-2, Sildenafil 100mg dle potřeby
**Alergologická:** neguje
**Abusus:** kouří 20 denně, nyní 3 cigarety/denně
**Epidemiologická:** neguje  

toot je napr. onko souhrn: **Onkologický souhrn** 23.12.2024 12:10 Peterková Tereza MUDr.
**Tumor kardie, dist. jícnu a subkardiální části žaludku T3 N1 M1 (hepar) HER2/neu 1+, PDL1 CPS 100, MSS**
**- 15.11.2024 Videogastroskopie:&#x20;**&#x53;tenozující tumor kardie s přerůstáním do fundu žaludku. Bez podstatné patologie proximální jícen, distálně žaludek, antru, D2 volné.
\- *histologie: vedle úseku diferencované sliznice skvamokolumnární junkce zastiženy v jednom ze vzorků struktury středně diferencovaného, invazivně rostoucího adenokarcinomu žaludku intestinálního typu. rozsah ani hloubku invaze nelze posoudit*
**- 20.11.2024&#x20;**&#x7A;aveden jícnový stent v NNH
**- 6.12.2024 CT hrudníku, břicha:** Tumor kardie, dist. jícnu a subkardiální části žaludku. Zaveden je stent. Meta postižení jater a mízních uzlin v epigastriu a retroperitoneu. Sklerosa aorty a jejích větví. Slabší sycení pr. ledviny
**- CT B+MP, H 4/2025 - PR&#x20;**- meta ložiska v parenchymu jater v částečné velikostní regresi, stac. počtu, dislokace jicnoveho stentu do ampuly rekta 
\- koloskopie 4/2025 - vyloučení jícnového stentu + extrakce stentu z konečníku 
\- kontrolní GFS 4/2025 - mírna stenoza lumen volně prostupná pro přístroj
**- CT B+MP+H 08/25 SD -**&#x56;.s. polyp v ascendens 35 mm cca 30 mm nad bauh. chlopní. Dop. doplnit kolonoskopii.
\- **paliativní chemoimunoterapie FOLFOX + Nivolumab&#x20;**(od 2. cyklu) od 1/2025
**- AEs** - od 3. cyklu deeskalace na **FUFA deGramont** - bez oxaliplatiny pro alergickou reakci - **st.p. 40. cyklu**
\- 10. cyklus bez nivolumabu pro hypertyreózu, **před 10.c., 11.c.: lab. hypertyreóza, od 15.cyklu hypotyreóza na substituci&#xA0;**
**- St.p. Kolonoskopie 1.10.2026 - Léze v colon. asc.  - Tis + další plošná léze v blízkosti - ponecháno in situ s ohledem na zákl. dg.&#xA0;**
**- Dle CT trvá parciální remise ložisek v játrech, pokračuje  v pal. chemoterapii FUFA deGramont + Nivolumab &#xA0;**

k MDT asi niečo viac condensed: **Premenopausální pacientka vstupně léčena pro DCIS mammae l. sin., st.p. SSME + SLND l. sin. 1/22, bez indikace adj. RT a bez HT, dále dispenzarizována. St.p. rekonstrukci vlevo implantátem 10/23, st.p. modelaci P prsu 4/24. V 1/26 nově pohmatový nález vlevo, na UZ dvě suspektní ložiska, histologicky invazivní ca mammae l.sin. NST G3, cT1c duplex cN0 M0, ER 0 %, PR 0 %, Ki-67 80-85 %, HER2 3+, st.p. neoCHT 4C AC + 12C paclitaxel, 5C Phesgo, následně st.p. dvojité TE + revizi axily l. sin. se zachováním implantátu 8/26, histologicky pCR ypT0 ypN0(0/7) M0, TRG1. Indikována k adjuvantní RT pro lokální recidivu v již dříve operovaném L prsu, dále pokračování Phesgo do celkové délky 1 roku. anebo este viac condense na prezentovali pacienta, na jeho představenie ostatním lekárom na MDT, aby pochopili, čo to je za pacienta a aka je jeho onko cesta so far&#x20;**

potom chceme aby tie datumy zozbrziek biopsie etc. aby to bolo on the line a možno pod tým nejaká summary a možnosť potom rozkliknúť full text tých jednitlivých vyšetrení..

## Response:
16/10/2026, 14:33:25 · gpt-6

Toto už je veľmi konkrétny návrh produktu. A myslím si, že teraz sa nám črtá zásadná vec: **nemali by sme vytvárať len jedno AI summary, ale tri rôzne úrovne informácií o pacientovi.** Každá slúži na iný účel.

1. **Patient record** – kompletný, štruktúrovaný profil pacienta vrátane podrobnej anamnézy, medikácie a všetkých vyšetrení.
2. **MDT presentation** – krátke, klinicky relevantné predstavenie pacienta, ktoré môže lekár prečítať za 30–60 sekúnd, plus vizuálna časová os.
3. **MDT protocol** – oficiálny výstup obsahujúci anamnézu, onkologický súhrn, otázku pre MDT, prítomných odborníkov a následne schválený záver.

Všetky tri by mali čerpať z rovnakých údajov, ale nemali by zobrazovať rovnaké množstvo textu.

## 1\. Databáza pacientov – čo by mala obsahovať

| Pole | Účel |
|--------|--------|
| Patient ID, meno, dátum narodenia | Identifikácia |
| Diagnóza | Základná onkologická diagnóza |
| **Owner** | Lekár zodpovedný za prípravu a koordináciu prípadu |
| **Referring department** | Pracovisko, odkiaľ pacient prichádza |
| Referring physician | Lekár, ktorý pacienta odoslal |
| Next MDT date | Najbližší termín prezentácie |
| MDT status | New / Scheduled / Needs attention / Ready / Completed |
| Last data update | Kedy sa naposledy aktualizovala dokumentácia |

Owner nemusí byť ten istý lekár, ktorý pacienta odoslal, ani ten, kto neskôr potvrdí MDT záver.

Filtre by som dala podľa statusu, termínu MDT, ownera, pracoviska a diagnózy. Pridala by som aj možnosť **My patients**, aby každý lekár videl prípady, za ktoré zodpovedá.

## 2\. Prítomní na MDT – konfigurácia podľa pracoviska

Tvoj nápad s preddefinovanými špecializáciami a lekármi je veľmi praktický. Nemusíme na každom MDT ručne vypisovať mená.

## MDT Attendance

Neuroonkologické MDT · Ilustračná konfigurácia pracoviska

---

lekári označení ako prítomní [Copy]

Mená sú vymyslené. V reálnej aplikácii sa personál spravuje v nastaveniach pracoviska.

Výber prítomných by sa mal robiť **raz pre celé MDT zasadnutie**, nie osobitne pri každom pacientovi. Ak sa niekto pripojí neskôr alebo odíde, môžeme zaznamenať odlišnú účasť pri konkrétnom prípade.

## 3\. Anamnéza – kompletná štruktúra

Tu by som sa držala českého klinického štandardu, ktorý si poslala, ale rozšírila ho o časové údaje a štruktúrované polia.

| Sekcia | Čo extrahovať |
|--------|--------|
| **Osobní anamnéza (OA)** | Chronické ochorenia, predchádzajúce operácie, hospitalizácie, rok diagnózy, relevantné komplikácie |
| **Rodinná anamnéza (RA)** | Príbuzenský vzťah, onkologické ochorenia, typ nádoru, vek pri diagnóze, prípadne iné významné ochorenia |
| **Pracovní anamnéza (PA)** | Povolanie, charakter práce, expozície, aktuálne zamestnanie alebo dôchodok |
| **Sociální anamnéza (SA)** | S kým pacient žije, bývanie, sebestačnosť, dostupná podpora |
| **Farmakologická anamnéza (FA)** | Názov lieku, dávka, cesta podania, frekvencia, prípadne dátum začiatku a ukončenia |
| **Alergologická anamnéza (AA)** | Alergén, typ reakcie, závažnosť, prípadne dátum |
| **Abúzus** | Fajčenie, alkohol, ďalšie návykové látky, intenzita a časové obdobie |
| **Epidemiologická anamnéza (EA)** | Relevantné infekčné riziká, očkovania, expozície |
| **Preventivní vyšetření** | Posledné relevantné preventívne prehliadky a screeningy, dátumy a výsledky |

Pri fajčení by systém mohol automaticky vypočítať balíčkoroky\:

$$
\text{Balíčkoroky}=\frac{\text{cigariet denne}}{20}\times\text{roky fajčenia}
$$

Ak sa intenzita fajčenia v priebehu života menila, musí počítať jednotlivé obdobia zvlášť.

A veľmi dôležité: ak dokumentácia neuvádza očkovanie, rodinnú anamnézu alebo preventívne vyšetrenia, systém má uviesť **„neuvedeno v dostupné dokumentaci“**, nie „neguje“.

Preventívne prehliadky by som nechala v rozšírenej anamnéze, nie automaticky v krátkej MDT prezentácii. V neuroonkológii bude často dôležitejší neurologický stav, výkonnostný stav, kortikoterapia alebo antiepileptická liečba.

## 4\. Onkologický súhrn – dve úrovne detailu

Tvoj príklad s karcinómom prsníka veľmi dobre ukazuje, čo potrebujeme. Lekár na MDT nepotrebuje čítať celú zdravotnú dokumentáciu. Potrebuje rýchlo pochopiť **kto je pacient, čo sa s ním doteraz dialo, aký je jeho aktuálny stav a prečo ho dnes prezentujeme.**

Navrhla by som preto prepínanie medzi dvoma úrovňami\:

**Onkologický súhrn** 

- MDT brief
- Detailed
Current selection unavailable.

Ilustračná úprava tebou dodaného prípadu, nie overený klinický záznam.

## 5\. Interaktívna onkologická timeline

Toto by podľa mňa mala byť jedna z hlavných vizuálnych funkcií aplikácie. Dátumy biopsií, MRI, operácií, rádioterapie a systémovej liečby budú zobrazené chronologicky. Po kliknutí na udalosť sa otvorí stručný výsledok a možnosť pozrieť celý originálny nález.

## Patient timeline

Ilustračný neuroonkologický prípad

Všetky udalosti sú syntetické a slúžia len na ilustráciu rozhrania.

Pre neuroonkológiu by som navyše umožnila **porovnanie dvoch MRI správ vedľa seba**\. Systém by zvýraznil rozdiely v lokalizácii, veľkosti, kontrastnom sýtení, edéme a interpretácii rádiológa. Nemal by však automaticky označiť progresiu iba na základe jedného rozdielu v texte.

## 6\. Ako to všetko prepojiť

**Patient Database + MDT Calendar**

Owner · Referring workplace · Status · Filters

**Patient Detail**

Full anamnesis · Documents · Oncology timeline · MRI comparison

**MDT Presentation**

30–60 second summary · Clinical question · Expandable findings

**MDT Protocol**

Anamnéza · Onkologický súhrn · Prítomní · Dotaz · Záver · Next steps · Schválenie

Guidelines modul by zostal dostupný ako samostatný panel nad štruktúrovanými údajmi, nie ako súčasť samotnej anamnézy. Jeho nezávislé hodnotenie by sa ukladalo oddelene od oficiálneho záveru MDT.

### Dve veci, ktoré by som ešte rozhodla s tímom

**Po prvé\:** Má AI generovať krátky onkologický súhrn automaticky z detailnej chronológie a umožniť lekárovi jeho editáciu? Ja by som určite áno, s možnosťou zobraziť zdroje a znovu vygenerovať návrh po aktualizácii dokumentácie.

**Po druhé\:** Keď pacient príde na MDT opakovane, má aplikácia automaticky ukázať, **čo sa zmenilo od posledného MDT**? Toto by som považovala za mimoriadne užitočnú funkciu, najmä v neuroonkológii, kde sa často rozhoduje podľa vývoja MRI nálezu a klinického stavu.

Za mňa by to bol jeden z najsilnejších prvkov produktu: **namiesto opakovaného čítania celej dokumentácie lekár okamžite vidí aktuálny stav, doterajšiu onkologickú cestu a nové udalosti od posledného zasadnutia.**

## Prompt:
16/10/2026, 14:36:17

Diagnóza
Základná onkologická diagnóza ako nejaké MKN
owner a referring Lekár je to isté 
last data update je relevant? 

jj super attendance

anamnéza super

## Response:
16/10/2026, 14:36:18 · gpt-6

Áno, upravila by som databázu podľa toho. **Owner a referring physician zlúčime** a diagnózu budeme evidovať pomocou MKN-10 (v češtine MKН-10).

### Finálne polia v databáze pacientov

| Pole | Obsah |
|--------|--------|
| **Patient** | Meno, priezvisko, identifikátor pacienta |
| **Diagnosis (MKN-10)** | Kód a názov diagnózy, napr. C71.9 – ZN mozku, NS |
| **Referring physician** | Lekár, ktorý pacienta odosiela na MDT a zodpovedá za prípad |
| **Department / Hospital** | Pracovisko, odkiaľ pacient prichádza |
| **MDT date** | Dátum plánovanej konzultácie |
| **Status** | New / Scheduled / Needs attention / Ready / Completed |

### Je „Last data update“ relevantný?

**Áno, ale nedávala by som ho ako hlavný stĺpec databázy.**

Rozlišovala by som dva dátumy\:

- **Last document uploaded** – kedy bol naposledy pridaný dokument.
- **Latest clinical finding** – dátum najnovšieho klinického vyšetrenia alebo výsledku.

To totiž nie je to isté. Napríklad dnes môže niekto nahrať MRI správu z minulého mesiaca.

Pre lekára je podstatnejšie vedieť, **či má pred MDT aktuálne podklady**\. Preto by som v databáze namiesto dátumu zobrazovala jednoduchý indikátor *Needs attention*, ak chýba relevantná dokumentácia alebo pribudli nové podklady, ktoré ešte neboli zahrnuté do schváleného summary.

Konkrétne dátumy by boli dostupné v detaile pacienta.

### Jedna drobná vec k diagnóze

MKN-10 je výborná na filtrovanie pacientov, ale pri neuroonkológii sama osebe nestačí na klinickú charakterizáciu nádoru.

Preto by som evidovala dve samostatné polia\:

**MKN-10\:** C71.9 – Zhoubný novotvar mozku, NS

**Integrovaná diagnóza\:** Glioblastom, IDH-wildtype, CNS WHO grade 4

Prvé využijeme v databáze a filtroch, druhé v onkologickom súhrne a pri rozhodovaní MDT.

Takže máme uzavreté **databázové polia, attendance aj štruktúru anamnézy**\. Ďalší krok by som venovala presnému návrhu onkologického súhrnu a timeline, pretože práve tam bude najväčšia klinická hodnota celej aplikácie.

## Prompt:
16/10/2026, 14:51:55

možno počas tej session bude voice recording a na základe toho sa napíše conclusion o next steps pre konkréhto pacienta (príp. ak chceme konzervatívne, alebo mechceme nahrávať tak tam bude space na rýchly zápis manuálne), a potom možno nejaké taskty na koordinaátorku, že má pacientovi dať evdieť, kedy bude mať aké ďalšie vyšetrenie, zákroky, a pod. even. jej to môže prísť do emailu..

## Response:
16/10/2026, 14:51:56 · gpt-6

Áno\! Toto by som určite pridala. A podľa mňa tým aplikácia získava ďalšiu veľmi dôležitú funkciu: **nekončí pri rozhodnutí MDT, ale pomáha zabezpečiť, aby sa rozhodnutie aj realizovalo.**

Navrhla by som to ako **MDT Session → Conclusion → Action Items**\.

## 1\. Počas MDT: dva spôsoby zápisu

Lekár si môže zvoliť, či chce využiť AI alebo zapisovať manuálne.

## MDT Session

Pacient NO-001 · Ilustračný príklad

(In progress)

- Manual notes
- AI recording
Current selection unavailable.

---

**After discussion**

Draft MDT conclusion

Extract next steps and assign responsibilities

Physician review and approval

Pri AI režime by bolo ideálne, keby systém vedel rozlíšiť, čo bolo iba navrhnuté počas diskusie a **čo bolo skutočne odsúhlasené ako záver MDT**\. To je klinicky veľmi podstatné.

## 2\. Po MDT: automaticky navrhnuté úlohy pre koordinátorku

Napríklad MDT rozhodne, že pacient má absolvovať kontrolné MRI a následne ambulantnú kontrolu. AI pripraví návrhy úloh, ktoré lekár alebo koordinátorka potvrdí.

## Action Items

Ukážkové úlohy po MDT

(open)

---

/  completed [Copy tasks]

Dôležité je, že **úloha „objednať MRI“ nie je to isté ako „MRI objednané“**\. Až keď koordinátorka skutočne zabezpečí termín, doplní dátum a môže pacienta informovať.

## 3\. Notifikácie koordinátorke

Po schválení MDT záveru by systém mohol vytvoriť úlohy a odoslať koordinátorke e-mail, napríklad\:

**MDT – nové úlohy na spracovanie**

K prípadu NO-001 boli priradené 3 nové úlohy. Otvorte zabezpečenú aplikáciu MDT Workspace a potvrďte ich prevzatie.

E-mail by obsahoval len nevyhnutné údaje a odkaz do aplikácie, nie celú zdravotnú dokumentáciu.

Koordinátorka by mala vlastnú obrazovku **My Tasks**, kde vidí všetky otvorené úlohy naprieč pacientmi, ich termíny a stav plnenia.

## 4\. Čo by som odporučila pre hackathon MVP

**Implementovať určite\:** manuálny zápis záveru, jeho schválenie, pridanie konkrétnych úloh, priradenie koordinátorke a zobrazenie úloh v jej dashboarde.

**Ako bonus\:** z audiozáznamu vytvoriť návrh záveru a automaticky extrahovať úlohy. Audio by sa spracúvalo len po výslovnom zapnutí a splnení nemocničných pravidiel súhlasu, ochrany údajov a uchovávania záznamu.

**Ako ďalšie rozšírenie\:** e-mailové notifikácie, pripomienky nesplnených úloh a prípadné prepojenie na nemocničný objednávací systém.

Ešte by som pridala jednu funkciu: **pri každom ďalšom MDT daného pacienta zobraziť predchádzajúci záver a stav jeho úloh**\. Napríklad „MRI objednané, výsledok dostupný, ambulantná kontrola zatiaľ neprebehla“.

Takto sa z MDT aplikácie nestane len nástroj na tvorbu dokumentácie, ale aj systém, ktorý podporuje **kontinuitu starostlivosti od rozhodnutia až po jeho realizáciu**\.

## Prompt:
16/10/2026, 14:56:56

a teraz ešte rozmýšľame možno by sme chceli guideline layer, ktorý by retrospektívne mohol zhodnotiť patient journey a missing information needed to make a proper decision about next steps, potom layer, ktorý by mohol navrhovalť suggestion next course of treatment, potom esteem jedna layer, ktorá by zhodnotila záver MDT.. 

je to naviac k tomuto challneg, možno nech to je optional nec'jaký button on and off pre tuto feature

## Response:
16/10/2026, 14:56:57 · gpt-6

Áno, a toto by mohla byť práve tá časť, ktorá váš projekt odlíši od bežného AI sumarizátora. **Základná aplikácia pomáha MDT pripraviť a zdokumentovať rozhodnutie. Guideline layer pomáha kriticky posúdiť, či má tím všetky potrebné informácie a či je rozhodnutie v súlade s dostupnými dôkazmi.**

Navrhla by som jeden voliteľný modul **Guideline Intelligence**, ktorý má tri samostatné fázy. Dôležité je ich časové oddelenie: AI by mala vytvoriť vlastné predbežné hodnotenie *predtým*, než pozná záver MDT, aby sa ním nenechala ovplyvniť.

## Guideline Intelligence – optional module

## Guideline Intelligence

Optional clinical decision-support module

- [ ]  \(Current selection unavailable.)

## Ako by som navrhla fungovanie troch vrstiev

**Layer 1 – Retrospective Patient Journey Audit**

Posudzuje doterajší priebeh diagnostiky a liečby. Oddeľuje skutočné potenciálne odchýlky od chýbajúcich údajov v dokumentácii. Zároveň vytvorí *MDT readiness checklist*\: ktoré informácie potrebujeme, aby sme mohli kvalifikovane rozhodnúť.

**Layer 2 – Independent Treatment Options**

Na základe dostupných údajov pripraví podmienené možnosti ďalšieho postupu, ich zdôvodnenie a zdroje. Namiesto jedného kategorického odporúčania ukáže aj alternatívy a faktory, ktoré môžu zmeniť rozhodnutie.

**Layer 3 – MDT Decision Review**

Porovná finálny návrh MDT s relevantnými guidelines, nezávislým predbežným hodnotením a novými skutočnosťami z diskusie. Upozorní na prípadné opomenutia, ale konečné rozhodnutie a jeho odôvodnenie zostávajú na lekároch.

## Jeden dôležitý produktový detail

Nedala by som všetky tri vrstvy spúšťať až po MDT. Lepšie je mať dva oddelené momenty\:

**Pred MDT**

Patient data → Journey Audit → Independent Treatment Options

Predbežné hodnotenie sa uloží ako nemenná verzia.

**MDT discussion**

Nové informácie → klinická diskusia → návrh záveru

**Po MDT**

Decision Review → prípadné upozornenia → potvrdenie lekárom

Aby sme obmedzili *anchoring bias*, môžeme dokonca umožniť lekárom predbežné AI odporúčanie **neotvoriť pred vlastnou diskusiou**\. Systém ho však už má pripravené a môže ho použiť pri záverečnej kontrole.

### Čo je nevyhnutné, aby bol modul klinicky dôveryhodný

- **Verifikované, verzované guidelines** \(napr. relevantné EANO/ESMO odporúčania pre danú diagnózu), nie voľné tvrdenia LLM bez zdrojov.
- **Prepojenie na konkrétne údaje pacienta** – pri každom tvrdení musí byť jasné, z ktorého nálezu pochádza.
- **Rozlišovanie „missing“ od „not indicated“** – neprítomnosť vyšetrenia automaticky neznamená nedostatočnú starostlivosť.
- **Možnosť zdokumentovať klinicky odôvodnenú odchýlku** – guidelines nie sú náhradou individuálneho rozhodovania.
- **Human-in-the-loop** – AI nič neschvaľuje, nepredpisuje ani automaticky nemení liečbu.

## Čo by som urobila na hackathone

Zachovala by som celý tento koncept v návrhu architektúry, ale pre funkčné demo by som vybrala **Layer 1 – Missing Information &amp; Patient Journey Audit**\. Je najbližšie k pôvodnému zadaniu a dá sa dobre demonštrovať na mock dokumentácii.

Layer 2 a 3 by som ukázala ako voliteľné rozšírenie, prípadne na jednom vopred pripravenom, odborne overenom syntetickom prípade.

A pomenovanie? **Guideline Intelligence** mi sedí viac než *Guideline Compliance Checker*\. Nechceme vytvárať systém, ktorý iba označuje rozhodnutia ako správne alebo nesprávne. Chceme podporiť lepšie informované, transparentné a klinicky odôvodnené rozhodovanie.

## Prompt:
16/10/2026, 14:57:43

asi tá msissing documentation by mala byť aj mimo tejto funkcie, mali by sme tam mať alert po uploadnutí dokumentácie

## Response:
16/10/2026, 14:57:44 · gpt-6

Áno, **missing documentation by som jednoznačne presunula do základnej funkcionality aplikácie**, nezávisle od Guideline Intelligence. Je to totiž jedna z hlavných požiadaviek hackathonu – pomôcť lekárom zistiť, či majú pred MDT všetky potrebné podklady.

Rozdelila by som to na dve samostatné funkcie\:

- **Documentation Readiness Check (core feature)\:** Máme dostatok aktuálnej a konzistentnej dokumentácie na prezentáciu pacienta?
- **Guideline Intelligence (optional)\:** Bola diagnostika a liečba v súlade s odporúčaniami a aké ďalšie postupy možno zvážiť?

## Čo sa stane po nahratí dokumentácie?

**Documentation Readiness**

Automatická kontrola po spracovaní dokumentov

**Patient NO-001** (Needs attention)

Histologický nález dostupný

Posledná MRI správa dostupná

MGMT status nenájdený v dokumentácii

Overiť, či bolo vyšetrenie vykonané a či je výsledok dostupný.

Aktuálny výkonnostný stav nezdokumentovaný

Doplniť KPS alebo ECOG, ak je relevantný pre rozhodnutie.

Rozdielne údaje o dátume operácie

Skontrolovať operačný protokol a prepúšťaciu správu.

Ilustračné upozornenia, nie hodnotenie skutočného pacienta. Relevantnosť jednotlivých položiek závisí od diagnózy a klinickej otázky.

## Ako by mali fungovať alerty

Rozlišovala by som tri typy\:

| Typ | Čo znamená |
|--------|--------|
| **Missing information** | Údaj sa v dostupných dokumentoch nepodarilo nájsť. |
| **Outdated information** | Údaj existuje, ale nemusí byť dostatočne aktuálny pre dnešné MDT. |
| **Conflicting information** | Dva zdroje uvádzajú potenciálne nezlučiteľné informácie. |

Pri každom upozornení by lekár mohol kliknúť na **View source**, doplniť informáciu, označiť ju ako nerelevantnú alebo potvrdiť, že je potrebné ju získať.

Zároveň by som nezobrazovala desiatky upozornení. AI by ich mala prioritizovať podľa významu pre konkrétnu klinickú otázku. Napríklad chýbajúci MGMT status môže byť zásadný pri rozhodovaní o liečbe glioblastómu, ale nemusí byť relevantný pri inom type nádoru.

### Dôležité rozlíšenie

**„Not found in documentation“ ≠ „Not performed“.**

AI nesmie tvrdiť, že pacient neabsolvoval vyšetrenie, iba preto, že jeho výsledok nebol nahratý. A zmena nálezu medzi dvoma dátumami sama osebe nie je rozpor – môže predstavovať prirodzený vývoj ochorenia.

## Aktualizovaný návrh aplikácie

**Patient Database + MDT Calendar**

**Upload Documentation**

Extraction · Chronology · Source linking

**Documentation Readiness Check**

Missing · Outdated · Conflicting

(Core feature)

**AI Patient Summary + Timeline**

**MDT Session → Conclusion → Tasks → PDF**

---

**Optional: Guideline Intelligence**

Patient journey audit · Treatment options · Decision review

(ON / OFF)

**Ešte jeden produktový detail\:** Po každom novom uploade by sa mali automaticky prepočítať upozornenia a aktualizovať návrh summary, ale už lekárom schválený dokument by sa nemal potichu prepísať.

A pre databázu by som pridala filter **Needs attention**, ktorý zobrazí všetkých pacientov s nevyriešenými upozorneniami. Takto bude koordinátorka alebo referring physician ešte pred MDT vedieť, pri ktorých pacientoch treba niečo doplniť.

Tým pádom je **Documentation Readiness súčasťou core MVP** a Guidelines Intelligence zostáva skutočne voliteľnou nadstavbou.

## Prompt:
16/10/2026, 15:00:14

možno aj nejaký alert, ktorý by povedal, že ak dodaný materiál je fotka alebo pdf ktoré nie je legible, tak nech poprosí o reupload

## Response:
16/10/2026, 15:00:18 · gpt-6

Áno\! Toto by som pridala ako **Document Quality Check**, ktorý sa automaticky spustí hneď po nahratí súboru, ešte pred generovaním AI summary.

Je to dôležité, pretože **AI môže z nekvalitného skenu nesprávne extrahovať informácie bez toho, aby si lekár všimol chybu**\.

### Ako by to vyzeralo v aplikácii

## Uploaded Documents

Patient NO-001 · Document Quality Check

(1 issue)

**Histologie\_2026.pdf**

12 pages · Text extracted successfully

---

**MRI\_zprava\_scan.pdf**

3 pages · Page 2 unreadable

**Document quality issue**

Strana 2 je rozmazaná a časť textu sa nepodarilo spoľahlivo prečítať. Dokument môže obsahovať informácie potrebné pre MDT.

[Copy reupload request] [Review issue]

Ilustračné súbory a výsledky kontroly kvality.

### Čo by mal systém automaticky kontrolovať

- **Unreadable / blurry\:** rozmazané fotografie, nízke rozlíšenie, zle osvetlené alebo otočené skeny.
- **Incomplete document\:** chýbajúce alebo odrezané strany, neúplný text.
- **Extraction failure\:** text sa nepodarilo extrahovať alebo sú kľúčové hodnoty nečitateľné.
- **Wrong patient / duplicate\:** potenciálne nesprávne priradený alebo opakovane nahratý dokument.

A tu by som zaviedla jednoduché pravidlo: **ak AI nedokáže spoľahlivo prečítať klinicky významný údaj, nesmie ho hádať ani potichu použiť v summary.**

### Ako sa to premietne do workflow

`Upload → Quality Check → Data Extraction → Documentation Readiness → AI Summary`

Ak dokument neprejde kontrolou, pacient dostane status **Needs attention** a referring physician alebo koordinátorka uvidí požiadavku na opätovné nahratie.

Pri čiastočne čitateľnom dokumente by systém mohol spracovať spoľahlivo prečítané časti, ale jasne označiť, čo sa nepodarilo overiť.

**Za mňa je toto súčasť core MVP, nie Guideline Intelligence.** Dokonca by som to zaradila medzi prioritné funkcie hackathonu – dá sa veľmi dobre demonštrovať na jednom kvalitnom a jednom rozmazanom skene.

## Prompt:
16/10/2026, 15:00:41

jj súhlasím

## Response:
16/10/2026, 15:00:49 · gpt-6

Super, tým pádom máme **Document Quality Check potvrdený ako súčasť core MVP**\.

Po nahratí dokumentácie bude systém automaticky kontrolovať čitateľnosť, úplnosť a spoľahlivosť extrakcie. Pri probléme zobrazí upozornenie, označí prípad ako *Needs attention* a umožní požiadať o opätovné nahratie dokumentu.

Guideline Intelligence zostáva samostatnou voliteľnou nadstavbou.

Ďalším logickým krokom bude spojiť všetky naše rozhodnutia do jedného **produktového zadania pre vývojárov**, s jasným rozdelením na MVP a bonusové funkcie, aby ste sa na hackathone sústredili na to najdôležitejšie.

## Prompt:
16/10/2026, 15:52:54

pathology, radiology, staging, comorbidities, previous treatment and other relevant findings. --> možno niekde by mohol byť checklist či pre kazždého apceinta máme vššekto so far available

## Response:
16/10/2026, 15:52:58 · gpt-6

Áno\! Toto by som nazvala **MDT Readiness Checklist** a umiestnila by som ho priamo do detailu každého pacienta, hneď nad AI summary.

Bola by to súčasť základnej aplikácie, nie voliteľného Guideline Intelligence modulu. Po nahratí dokumentácie by AI automaticky skontrolovala, ktoré informácie sú dostupné, ktoré chýbajú a ktoré treba overiť.

## MDT Readiness Checklist

## MDT Readiness

Patient NO-001 · Illustrative assessment

# /

Relevant categories available

Interaktívny návrh. V produkcii AI navrhne statusy podľa dokumentácie a lekár ich môže opraviť alebo potvrdiť.

### Ako by checklist fungoval

Každá kategória by mala štyri možné stavy: **Available**, **Missing**, **Needs review** a **Not applicable**\. AI ich predbežne vyhodnotí podľa dokumentácie, ale lekár môže stav upraviť.

Zároveň by som rozlišovala\:

- **Document missing** – napríklad nemáme histologickú správu.
- **Information missing** – histologickú správu máme, ale neobsahuje potrebný molekulárny marker.
- **Document unreadable** – správu máme, ale časť sa nepodarilo spoľahlivo prečítať.

Po kliknutí na *Pathology* by sa teda zobrazil podrobnejší checklist, napríklad histológia, IDH, 1p/19q, MGMT – **len tie položky, ktoré sú relevantné pre konkrétnu diagnózu a otázku MDT**\.

Pri neuroonkologických pacientoch by som nepoužívala univerzálnu požiadavku na TNM staging. Checklist by sa mal prispôsobiť typu nádoru – napríklad integrovaná WHO klasifikácia pri primárnych nádoroch CNS alebo rozsah systémového ochorenia pri mozgových metastázach.

A ešte jeden dôležitý detail: **100 % completeness nemusí byť podmienkou prezentácie pacienta na MDT.** Niekedy je práve otázkou pre MDT, ktoré ďalšie vyšetrenie treba indikovať.

Preto by som dovolila pokračovať aj s chýbajúcimi údajmi, ale upozornenia by zostali viditeľné a lekár by ich musel vedome zohľadniť.

Takto by sme mali v detaile pacienta veľmi logické poradie\:

**Uploaded Documents → Document Quality Check → MDT Readiness Checklist → AI Summary &amp; Timeline → MDT Session**

A v hlavnej databáze by sa z checklistu automaticky odvodzoval status **Needs attention**, takže koordinátorka hneď vidí, pri ktorých pacientoch treba niečo doplniť.

## Prompt:
16/10/2026, 15:54:23

ale akože asi by mohol prebhnúť mdt aj bez všektej dokumentácie, len to je taký chechlist čo ais by sme mali mať

## Response:
16/10/2026, 15:54:24 · gpt-6

Presne, **MDT Readiness Checklist má byť informatívny, nie blokujúci**\. Jeho úlohou je pomôcť lekárom rýchlo zistiť, aké podklady majú k dispozícii a čo prípadne chýba. Nemá rozhodovať o tom, či sa pacient môže prezentovať na MDT.

Dokonca môže byť dôvodom prezentácie práve to, že niektoré vyšetrenia ešte neboli vykonané a tím má rozhodnúť, či sú potrebné.

Navrhla by som preto takýto jednoduchý prehľad\:

## Available Clinical Information

Patient NO-001 · Ilustračný príklad

(Informational)

Pathology

Available

Radiology

Available

Staging / Disease classification

Not documented

Comorbidities

Available

Previous treatment

Available

Other relevant findings

Needs verification

---

Missing information does not prevent MDT discussion. (MDT allowed)

**Upravila by som aj logiku statusov\:** Pacient môže byť označený ako *Ready for MDT*, aj keď má niektoré informácie nedostupné. Status *Needs attention* by sme používali skôr pri problémoch, ktoré si vyžadujú konkrétny zásah – napríklad nečitateľný dokument, chybný upload alebo nevyriešený rozpor v identifikácii.

A chýbajúce informácie môžu byť dokonca jedným z výsledkov MDT: *„Doporučeno doplnit molekulárně genetické vyšetření a následně případ znovu prezentovat.“*

Čiže žiadny povinný completion score, žiadne blokovanie zasadnutia. **Len prehľadný checklist s možnosťou rozkliknúť, čo máme, čo nemáme a odkiaľ informácia pochádza.**

## Prompt:
16/10/2026, 16:01:29

ten UI nech má menu že database, a potom calendar.. 

nech vyzerá ako databáza pacientov je popísané čo sme sa už dohodli a potom asi nejaký calendar of the day, ked pridávaš nových pacientov, tak nech tam je kontrola kvality .. 

a potom nech sa dá rozkliknúť jeden pacient a tam bude vidno tie odchálky so far a suggested course of treatment a tam nech je reference na patient documentation, guideline reference, guideline name, year of release.. 

a potom možno nech sa calendar dá minimalizovať na jednu stranu nech vidíme, koľko pacientov je ešte pred nami.. ato nech sa dá schovať..

a potom nech sa dá rozkliknuť jeden pacient a tam bude to čo se probírali tá anamnéza, onko súhrn, mdt brief, okno na záver.. atd...

## Response:
16/10/2026, 16:01:30 · gpt-6

Áno, toto by som už poňala ako **finálnu informačnú architektúru MDT Workspace**\. Základom budú dve hlavné položky menu - **Database** a **Calendar**\. Po otvorení pacienta sa dostaneme do jeho klinického profilu, kde sa dá pripraviť aj viesť MDT.

Najdôležitejšie je, aby lekár nemusel prechádzať medzi viacerými obrazovkami počas prezentácie. **MDT brief, timeline, dokumentácia, AI upozornenia a priestor na záver majú byť dostupné v jednom pracovnom prostredí.**

## Navrhované rozloženie aplikácie

**Main navigation**

**Database**

Všetci pacienti, vyhľadávanie, filtre, nový pacient, dokumentácia a statusy.

**Calendar**

MDT zasadnutia, zoznam pacientov na daný deň, poradie a priebeh prezentácií.

Obe sekcie otvárajú rovnaký profil pacienta.

**Patient Workspace**

MDT Brief · Anamnéza · Onkologický súhrn · Timeline · Documentation · Guidelines · Conclusion · Tasks

### 1\. Database

Zachovala by som všetky dohodnuté polia: pacient, MKN-10 diagnóza, referring physician (zároveň owner), odosielajúce pracovisko, dátum MDT a status. Nad tabuľkou budú filtre **All / Upcoming / Needs attention / Completed**, plus filtrovanie podľa lekára, pracoviska, diagnózy a dátumu.

Pri **Add Patient** bude možné založiť pacienta, nahrať dokumentáciu a rovno ho zaradiť na konkrétny termín MDT. Upload automaticky spustí kontrolu kvality súborov, extrakciu údajov a informatívny checklist dostupnej dokumentácie. Nečitateľný sken vyvolá žiadosť o reupload; chýbajúce vyšetrenie však nebude blokovať MDT.

### 2\. Calendar

Kalendár by mal mať pohľad na mesiac/týždeň a najmä **Day View**, ktorý je praktický počas samotného zasadnutia.

V Day View sa zobrazí zoznam pacientov v poradí, v akom majú byť prezentovaní. Každého možno otvoriť, označiť ako Completed alebo presunúť na iný termín.

Po otvorení pacienta sa kalendár zmení na **minimalizovateľný bočný panel**\. Lekár tak stále vidí, kto je na rade a koľko pacientov zostáva, ale panel môže úplne schovať.

## 3\. Patient Workspace - hlavná klinická obrazovka

Navrhla by som tri časti: hlavný obsah pacienta, pravý panel s AI upozorneniami a voliteľný bočný panel s dnešným kalendárom.

## Patient NO-001

Neuro-oncology · MDT 16 Oct 2026

(Scheduled)

[Guidelines]

---

Interaktívny wireframe štruktúry. Neobsahuje skutočné pacientské údaje ani generované klinické odporúčania.

## 4\. Ako presne zobrazovať guideline findings

Tu by som bola veľmi dôsledná. Každé zistenie alebo navrhovaný postup musí byť vysvetliteľný a dohľadateľný.

| Pole | Čo musí obsahovať |
|--------|--------|
| **Finding** | Potenciálna odchýlka, klinická otázka alebo navrhovaný postup |
| **Patient evidence** | Konkrétny dokument, dátum, strana/úsek a citovaný údaj |
| **Guideline reference** | Názov odporúčania, odborná spoločnosť, rok vydania, verzia, konkrétna sekcia |
| **Assessment** | Prečo je odporúčanie relevantné pre daného pacienta |
| **Uncertainty** | Čo nevieme alebo čo môže zmeniť interpretáciu |
| **Clinician review** | Confirmed / Clinically justified / Rejected / Needs more information |

Odporúčania by sa nemali generovať iba z všeobecných znalostí modelu. Pre tento modul potrebujete kurátorovaný súbor guidelines, overiteľné citácie a jasne oddelené predbežné hodnotenie od finálneho klinického rozhodnutia.

## 5\. Dôležitá logika celého workflow

**Database → Add Patient**

Založenie pacienta, MKN-10, referring physician, pracovisko, termín MDT a upload dokumentácie.

**Automatic Document Processing**

Kontrola kvality, extrakcia, dostupnosť dokumentácie, upozornenia na chýbajúce alebo rozporné údaje.

**Optional Guideline Intelligence - pred MDT**

Retrospektívny audit a nezávislé predbežné možnosti ďalšieho postupu.

**Calendar → MDT Session**

Zoznam pacientov, attendance podľa špecializácií, prezentácia pacienta, manuálne poznámky alebo voliteľný audiozáznam.

**Conclusion → Optional Decision Review**

Záver MDT, prípadná kontrola súladu s guidelines, potvrdenie oprávneným lekárom.

**Tasks → Coordinator → PDF**

Úlohy, zodpovednosti, termíny, voliteľné e-mailové upozornenia a export protokolu.

### Čo by som prioritizovala pri implementácii

**Core MVP\:** Database, Calendar, pridanie pacienta, upload a kontrola kvality dokumentácie, checklist dostupných informácií, anamnéza, onkologický súhrn, MDT brief, timeline, manuálny záver a PDF.

**Druhá priorita\:** Minimalizovateľný denný kalendár, attendance, úlohy koordinátorke a AI návrh záveru z diskusie.

**Optional / bonus\:** Všetky tri Guideline Intelligence vrstvy s citáciami na pacientsku dokumentáciu a presné odborné odporúčania.

Z UX pohľadu by som ešte urobila jednu zásadnú vec: **počas MDT sa má pacient otvárať štandardne na záložke MDT Brief, nie na celej anamnéze.** Lekár tak okamžite vidí to, čo potrebuje na prezentáciu. Všetko ostatné má dostupné jedným kliknutím.

Tým zachováme dve vlastnosti, ktoré sú pre tento produkt najdôležitejšie: **rýchlosť prezentácie a možnosť okamžite dohľadať detail či zdroj každého klinického tvrdenia.**

---

If you want, I can:

- Summarize this conversation
- Design the final MDT Workspace UI
- Outline the MDT Workspace information architecture



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)