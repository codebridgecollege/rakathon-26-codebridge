# Demo org C: the lung cancer MDT

Ten fictional patients for "Ukázková nemocnice C", the Plicní MDT that meets on Tuesdays at 14:00. Everything is
invented. `patients.py` holds their outpatient reports. `scripts/add_lung_org.py` prints each report to a PDF and adds
the org, its staff and the patients to a database without touching any other org. Their documents then go through the
real reading pipeline, so what the app shows comes from the page reader and the AI model, not from prepared data.

| Case | What it exercises |
|---|---|
| C01 | FEV1 and DLCO low, COPD: lobectomy versus SBRT |
| C02 | Primary biliary cholangitis and autoimmune thyroiditis before immunotherapy |
| C03 | EF 30 %, heart failure, anticoagulant: surgery versus chemoradiotherapy |
| C04 | eGFR low, neuropathy: cisplatin versus carboplatin |
| C05 | Suspected interstitial lung disease; an echo requested with no result yet |
| C06 | Karnofsky 60 %, not ECOG; a spirometry that was not done |
| C07 | A suspicion with no histology; a father's arthritis and "no autoimmune disease" must not raise a chip |
| C08 | Anticoagulant, brain metastases |
| C09 | HBsAg positive, pacemaker, radiation pneumonitis, PS 2 |
| C10 | Clean case with negations ("Neguje autoimunitní onemocnění", "Bez srdečního selhání") |
