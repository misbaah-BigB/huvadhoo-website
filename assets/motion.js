/* Huvadhoo Maldives Travel — shared site interactivity.
   Loaded on every page. Every element lookup is guarded so this file is a
   safe no-op for whichever pieces a given page doesn't have. */
(function(){

  // mobile nav toggle
  const burger = document.getElementById('burgerBtn');
  const mobileNav = document.getElementById('mobileNav');
  if (burger && mobileNav) {
    burger.addEventListener('click', () => {
      const open = mobileNav.classList.toggle('open');
      burger.setAttribute('aria-expanded', open);
    });
    mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      mobileNav.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    }));
  }

  // faq accordion
  document.querySelectorAll('.faq-item').forEach(item => {
    const q = item.querySelector('.faq-q');
    if (!q) return;
    q.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });

  // blog category filter
  const chips = document.querySelectorAll('.chip');
  if (chips.length) {
    const postCards = document.querySelectorAll('.post-card');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const filter = chip.dataset.filter;
        postCards.forEach(card => {
          card.style.display = (filter === 'all' || card.dataset.cat === filter) ? 'flex' : 'none';
        });
      });
    });
  }

  // quote form (demo only — no backend wired up yet, but the interaction
  // itself is real: the form has novalidate so we drive validation styling
  // ourselves instead of relying on inconsistent native tooltips, a brief
  // loading state on submit instead of an instant swap, then a fade-in
  // success panel)
  const quoteForm = document.getElementById('quoteForm');
  if (quoteForm) {
    quoteForm.addEventListener('submit', function(e){
      e.preventDefault();
      this.classList.add('was-validated');
      if (!this.checkValidity()) {
        const firstInvalid = this.querySelector(':invalid');
        if (firstInvalid) firstInvalid.focus();
        return;
      }

      const form = this;
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.classList.add('is-loading');

      setTimeout(() => {
        form.style.display = 'none';
        const ty = document.getElementById('thankYou');
        if (!ty) return;
        ty.classList.add('show');
        // two rAFs so the browser commits the display:block before we
        // start the opacity/transform transition (otherwise it can skip
        // straight to the end state with no animation)
        requestAnimationFrame(() => requestAnimationFrame(() => ty.classList.add('is-visible')));
      }, 500);
    });
  }

  // hero bubbles
  const heroEl = document.getElementById('waveHero');
  if (heroEl) {
    for (let i = 0; i < 8; i++) {
      const b = document.createElement('div');
      b.className = 'hero-bubble';
      const size = 4 + Math.random() * 7;
      b.style.width = size + 'px';
      b.style.height = size + 'px';
      b.style.left = Math.random() * 100 + '%';
      b.style.animationDuration = (7 + Math.random() * 7) + 's';
      b.style.animationDelay = (Math.random() * 7) + 's';
      heroEl.appendChild(b);
    }
  }

  // tilt cards — was product-card only (via a manually-added data-tilt
  // attribute); now applies to every clickable card sitewide via the same
  // card-selector convention the hover-lift/image-zoom CSS uses (see the
  // comment above that CSS block in site.css for why it's two attribute
  // selectors, not one — the short version: the reveal class appended
  // below breaks a plain [class$="-card"] match), so post-card and
  // related-card get it too without touching their markup. Informational,
  // non-clickable cards (value-card, why-card, etc.) are untouched — a 3D
  // tilt on a box that isn't a link would be a false affordance, same
  // reasoning already applied to the hover-lift rule. JS-set inline
  // transform intentionally overrides the CSS :hover lift for mouse users
  // (richer effect); keyboard/touch users still get the CSS-only lift via
  // :focus-within, untouched by this. Skipped entirely under
  // prefers-reduced-motion — a continuous mouse-linked 3D rotation is
  // exactly the kind of motion that preference exists to opt out of,
  // matching how the hero parallax and custom cursor already gate on it.
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('a[class$="-card"], a[class*="-card "]').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-3px)`;
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
      card.addEventListener('touchstart', () => { card.style.transform = 'scale(0.98)'; }, {passive:true});
      card.addEventListener('touchend', () => { card.style.transform = ''; }, {passive:true});
    });
  }

  // atoll map — global so the inline onclick="selectAtoll(this)" can reach it.
  // The info panel briefly dips in opacity while its text swaps rather than
  // changing instantly — a short crossfade instead of a jump cut. The dip's
  // transition is set as an inline style, scoped to just this interaction,
  // rather than added to the .info-box CSS rule — that rule's element also
  // carries the entrance-reveal .reveal class, which already owns the
  // `transition` property for its own fade-up; a second, permanent
  // transition rule on the same property would silently replace it instead
  // of combining. Clearing the inline style afterward hands control back to
  // the reveal system exactly as before. Under prefers-reduced-motion the
  // sitewide blanket rule strips transitions entirely (it's !important, so
  // it wins over this inline style), so this collapses to an instant swap
  // with no visible dip, exactly as it should.
  //
  // Two timers are tracked and cancelled on every call. Tapping a second
  // atoll before the first tap's swap finished used to leave two untracked
  // setTimeout chains running at once — the older chain's "clear the inline
  // transition" timer could fire in the middle of the newer chain's opacity
  // animation, cancelling it mid-flight and freezing the panel at whatever
  // partial opacity it happened to be at (often near-invisible). Clearing
  // any timers from a previous tap before starting a new one means only the
  // most recent tap's chain ever runs to completion.
  let atollSwapTimer = null;
  let atollTransitionClearTimer = null;
  window.selectAtoll = function(el) {
    document.querySelectorAll('.atoll').forEach(a => a.classList.remove('selected'));
    el.classList.add('selected');
    const box = document.getElementById('atollInfo');
    if (!box) return;

    if (atollSwapTimer) clearTimeout(atollSwapTimer);
    if (atollTransitionClearTimer) clearTimeout(atollTransitionClearTimer);

    box.style.transition = 'opacity .14s var(--ease-snap)';
    box.classList.add('is-swapping');
    atollSwapTimer = setTimeout(() => {
      const eyebrow = box.querySelector('.eyebrow2');
      if (eyebrow) eyebrow.textContent = box.dataset.selectedLabel || eyebrow.textContent;
      const h3 = box.querySelector('h3');
      if (h3) h3.textContent = el.dataset.name;
      const p = box.querySelector('p');
      if (p) p.textContent = el.dataset.info;
      box.classList.remove('is-swapping');
      atollSwapTimer = null;
      atollTransitionClearTimer = setTimeout(() => {
        box.style.transition = '';
        atollTransitionClearTimer = null;
      }, 160);
    }, 140);
  };

  // Pre-existing gap, fixed here since it's the same component: a <g> with
  // tabindex="0" is focusable but — unlike <button> or <a> — browsers don't
  // natively activate it on Enter/Space, so keyboard users could tab to an
  // atoll but never actually select it. Wiring it up directly.
  document.querySelectorAll('.atoll').forEach(el => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectAtoll(el);
      }
    });
  });

  // ---- preferred contact channel (WhatsApp / Telegram / WeChat) ----
  // Same two signals as the homepage's language-redirect: navigator.language
  // first, browser timezone as a tiebreaker only when the language is
  // generic (plain "en") or unrecognized. No location permission needed —
  // Intl.DateTimeFormat().resolvedOptions().timeZone reads the timezone the
  // device already has set, instantly.
  function preferredChannel(){
    try {
      const rawLang = ((navigator.language || navigator.userLanguage || '') + '').toLowerCase();
      const langBase = rawLang.split('-')[0] || '';

      if (langBase === 'zh') return 'wechat';
      if (langBase === 'ru' || langBase === 'be') return 'telegram';
      if (langBase && langBase !== 'en') return 'whatsapp';

      let timeZone = '';
      try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
      const TZ_CHANNEL = {
        'Asia/Shanghai':'wechat','Asia/Chongqing':'wechat','Asia/Urumqi':'wechat','Asia/Harbin':'wechat',
        'Europe/Moscow':'telegram','Europe/Minsk':'telegram','Europe/Kaliningrad':'telegram','Europe/Samara':'telegram',
        'Asia/Yekaterinburg':'telegram','Asia/Novosibirsk':'telegram','Asia/Vladivostok':'telegram','Asia/Omsk':'telegram',
        'Asia/Krasnoyarsk':'telegram','Asia/Irkutsk':'telegram'
      };
      return TZ_CHANNEL[timeZone] || 'whatsapp';
    } catch (e) {
      return 'whatsapp';
    }
  }

  const preferred = preferredChannel();
  document.querySelectorAll('[data-channel]').forEach(function(el){
    const isPreferred = el.getAttribute('data-channel') === preferred;
    if (el.classList.contains('float-primary') || el.classList.contains('float-secondary')) {
      el.classList.toggle('float-primary', isPreferred);
      el.classList.toggle('float-secondary', !isPreferred);
    } else if (el.classList.contains('footer-contact-link')) {
      el.classList.toggle('is-primary', isPreferred);
    } else if (el.classList.contains('btn')) {
      el.classList.toggle('btn-gold', isPreferred);
      el.classList.toggle('btn-ghost-dark', !isPreferred);
      el.classList.toggle('btn-sm', !isPreferred);
    }
  });

  // ---- hero parallax (mouse-driven wave depth) ----
  // Atmospheric only: adds a small amount of depth to a hero's wave
  // layer(s) as the cursor moves. Uses the standalone `translate` property
  // (not `transform`) so it layers independently on top of the existing
  // waveMove transform animation without ever resetting or fighting it —
  // verified in isolation before writing this. Gated to devices with a
  // real mouse (hover + fine pointer) and off entirely under
  // prefers-reduced-motion, so touch visitors and reduced-motion visitors
  // never pay for or see this at all.
  //
  // Originally homepage-only (#waveHero, two layers). Generalized so the
  // same technique also runs on the 13 inner-page .pagehero sections,
  // which carry a single, lower-profile wave layer — one function, wired
  // to whichever hero elements are actually present on a given page.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    function wireHeroParallax(heroEl) {
      const layers = [
        { el: heroEl.querySelector('.hero-wave-1'), x: 10, y: 6 },
        { el: heroEl.querySelector('.hero-wave-2'), x: 5, y: 3 }
      ].filter(l => l.el);
      if (!layers.length) return;

      let ticking = false;
      let lastEvent = null;

      function apply() {
        ticking = false;
        if (!lastEvent) return;
        const r = heroEl.getBoundingClientRect();
        const nx = (lastEvent.clientX - r.left) / r.width - 0.5;
        const ny = (lastEvent.clientY - r.top) / r.height - 0.5;
        layers.forEach(l => {
          l.el.style.translate = (nx * l.x).toFixed(1) + 'px ' + (ny * l.y).toFixed(1) + 'px';
        });
      }

      heroEl.addEventListener('mousemove', (e) => {
        lastEvent = e;
        if (!ticking) { ticking = true; requestAnimationFrame(apply); }
      });
      heroEl.addEventListener('mouseleave', () => {
        layers.forEach(l => { l.el.style.translate = '0px 0px'; });
      });
    }

    document.querySelectorAll('#waveHero, .pagehero').forEach(wireHeroParallax);
  }

  // ---- custom cursor (subtle accent dot, desktop only) ----
  // Augments the real cursor, never replaces it — the OS cursor is left
  // completely alone, so form fields, text selection, and any assistive
  // tooling keep working exactly as normal. Only created on devices with
  // a real mouse (hover + fine pointer); on touch devices this whole
  // block never runs and no element is ever added to the page. Also
  // skipped entirely under prefers-reduced-motion, since a dot that
  // continuously trails the pointer is a form of motion some visitors
  // will have asked to avoid.
  (function(){
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const dot = document.createElement('div');
    dot.className = 'custom-cursor';
    dot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(dot);

    const INTERACTIVE = 'a, button, .btn, [data-tilt], .atoll, [class$="-card"], [class*="-card "]';
    const SUPPRESS = 'input, textarea, select, [contenteditable]';

    let ticking = false;
    let lastEvent = null;

    function apply() {
      ticking = false;
      if (!lastEvent) return;
      dot.classList.add('is-active');
      dot.style.translate = lastEvent.clientX + 'px ' + lastEvent.clientY + 'px';
      const overSuppressed = !!lastEvent.target.closest(SUPPRESS);
      const overInteractive = !!lastEvent.target.closest(INTERACTIVE);
      dot.classList.toggle('is-hover', overInteractive && !overSuppressed);
      dot.classList.toggle('is-hidden', overSuppressed);
    }

    document.addEventListener('mousemove', (e) => {
      lastEvent = e;
      if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    });
    document.documentElement.addEventListener('mouseleave', () => {
      dot.classList.remove('is-active');
    });
  })();

  // ---- image reveal (fade+scale-in on load, for future photography) ----
  // No <img> tags exist on the site yet (placeholder gradients only), so
  // this is a no-op today — but the moment real photos are added inside a
  // .card-media or .gallery wrapper, they'll fade+scale in on load
  // instead of popping in abruptly. Progressive enhancement only: the
  // hidden state is applied here in JS, never in static HTML/CSS.
  document.querySelectorAll('.card-media img, .gallery img').forEach(img => {
    img.classList.add('img-reveal');
    if (img.complete) {
      img.classList.add('is-loaded');
    } else {
      img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
    }
  });

  // ---- entrance reveal (fade-up, staggered for card groups) ----
  // Progressive enhancement only: the .reveal class (and the opacity:0
  // state it carries) is applied here, in JS, and nowhere else — never in
  // static HTML or a plain CSS rule. If this fails or IntersectionObserver
  // isn't available, the branch below simply never runs and the page is
  // fully visible by default, exactly as if this feature didn't exist.
  if ('IntersectionObserver' in window) {
    const groups = document.querySelectorAll('[class$="-grid"]:not(.foot-grid), .steps, .timeline, .map-demo');
    const revealEls = [];

    groups.forEach(group => {
      Array.from(group.children).forEach((child, i) => {
        child.classList.add('reveal');
        child.style.transitionDelay = (Math.min(i, 5) * 70) + 'ms';
        revealEls.push(child);
      });
    });

    document.querySelectorAll('.section-head').forEach(el => {
      el.classList.add('reveal');
      revealEls.push(el);
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    revealEls.forEach(el => observer.observe(el));
  }

  // back-to-top button (Ocean Teal pages only — no-op elsewhere)
  const backToTop = document.getElementById('backToTop');
  if (backToTop) {
    window.addEventListener('scroll', () => {
      backToTop.classList.toggle('visible', window.scrollY > 600);
    }, { passive: true });
    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // floating WhatsApp/Telegram/WeChat widget — stay hidden until the hero has scrolled past,
  // so it doesn't sit on top of the hero's own contact buttons
  const floatContact = document.getElementById('floatContact');
  if (floatContact) {
    const heroSection = document.querySelector('#waveHero, .pagehero');
    if (heroSection) {
      const toggleFloatContact = () => {
        floatContact.classList.toggle('visible', heroSection.getBoundingClientRect().bottom <= 0);
      };
      toggleFloatContact();
      window.addEventListener('scroll', toggleFloatContact, { passive: true });
    } else {
      floatContact.classList.add('visible');
    }
  }

})();
