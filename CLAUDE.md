# Huvadhoo Maldives Travel — Website Project

## Business
Huvadhoo Maldives Travel — a Maldives-based travel concierge agency. Sells resort stays, local island guesthouses, honeymoon/family/diving/fishing/camping packages, and a signature "Resort + Local Island Combo." Positioning: honest local advice, one clear total price before payment, no hidden costs.

## Contact
WhatsApp +960 7444281 (used as `wa.me/9607444281` in links)

## Design system (reuse for any new/edited page)
- Colors: ink #0B2A2E, teal-deep #114C49, teal #1F7A6C, aqua #5FD3C4, sand #F5EEDF, sand-dark #E7DCC2, gold #D9A64E (CTA accent)
- Fonts: Fraunces (headings), Inter (body), IBM Plex Mono (numbers/prices)
- Signature visual: a "depth gauge" gradient (aqua → teal → ink), used in hero sections and progress indicators
- Every page shares the same header/nav/footer structure — keep new pages consistent with existing ones
- Homepage has three interactive elements worth reusing the same patterns for: an animated CSS/SVG wave hero, a clickable atoll map (SVG shapes + JS), and CSS 3D-tilt hover cards. Keep any new interactive elements lightweight — no 3D model files or heavy libraries — since load speed matters more than novelty for this site.

## Existing pages
index, resorts, guesthouses, combo, honeymoon, family, diving, fishing, camping, transfer-guide, cost-guide, local-island-rules, blog (+ 9 posts), about — all plain HTML/CSS/JS, no framework, no build step.

## Known issue to watch for
Earlier drafts of this site had a recurring bug: literal text like `\u2014` appearing instead of a real em-dash character, because escape sequences were typed directly into HTML text/attributes (where they don't get interpreted) rather than inside real JS string literals. This has been fixed across the whole site as of this file's creation — when writing new content, always use the actual UTF-8 character (—, –, →, etc.) directly, never a `\uXXXX` escape, unless it's genuinely inside a JS string in a `<script>` tag.

## Working style — read this before making changes
The site owner is new to coding. When responding to requests:
- Explain things in plain language, no unexplained jargon
- Prefer offering a small set of clear options over open-ended questions
- Prices on the site are illustrative placeholders unless stated otherwise
- Any new page must keep navigation and footer links consistent with the rest of the site (update nav/footer on existing pages too when adding a new one)
- Don't restructure the design system or page conventions without asking first
