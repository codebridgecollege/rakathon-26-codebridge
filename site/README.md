# glidemdt.com landing page

A static teaser page for GLIDE MDT: one `index.html` with inline CSS, the Manrope and DM Sans
web fonts, and images in `img/`. No build step and no JavaScript.

- **Copy:** the team's pitch, in Czech.
- **Design:** follows glideanalysis.com, the GLIDE clinical audit site: the same colours and fonts,
  two-tone headlines, ruled ledes, mint buttons, evidence cards and numbered steps.
- **Images:** real screenshots of the prototype with synthetic data.

## Rebuild the images

```
uv run mocks/build.py                                   # the app page the screenshots come from
COVER_DEPS=/tmp/cover-deps node scripts/cover/build.mjs # screenshots (see the script header for setup)
uv run scripts/site/build_images.py                     # light JPEGs into site/img
```

## Before publishing

- Replace `CONTACT_EMAIL` in the "Domluvit pilot" button.
- Check the GLIDE results figures and their caveat with the clinical lead.

## Deploy

Cloudflare Pages, project `glidemdt`:

```
npx -y wrangler@4.147.0 pages deploy site --project-name glidemdt --branch main
```

Then add `glidemdt.com` as a custom domain of the project in the Cloudflare dashboard (Workers &
Pages, glidemdt, Custom domains). If the domain's DNS is on Cloudflare, the record is created
automatically; otherwise point a CNAME at `glidemdt.pages.dev`.
