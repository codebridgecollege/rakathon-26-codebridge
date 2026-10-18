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

## Analytics

Umami Cloud, cookieless, counting only `glidemdt.com` and `www.glidemdt.com`. The script tag is in the page head
(website ID `77af4838-ef34-4cdd-bb26-103f2f41a254`). Button clicks are sent as events through
`data-umami-event` attributes: `header-kontakt`, `hero-chci-pilot`, `hero-jak-to-funguje` and
`footer-email`. The contact buttons open an e-mail to sona.hudecova@codebridgecollege.com.

## Deploy

Cloudflare Pages project `glidemdt`, live at https://glidemdt.com (and www.glidemdt.com,
glidemdt.pages.dev). `.github/workflows/deploy-site.yml` redeploys on every push to `main` that
changes `site/`. By hand:

```
npx -y wrangler@4.147.0 pages deploy site --project-name glidemdt --branch main --force
```

The custom domains are attached to the project (Workers & Pages, glidemdt, Custom domains); the
domain's DNS is on Cloudflare, so the records and certificates are managed there.
