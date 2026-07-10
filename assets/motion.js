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

  // quote form (demo only — no backend wired up yet)
  const quoteForm = document.getElementById('quoteForm');
  if (quoteForm) {
    quoteForm.addEventListener('submit', function(e){
      e.preventDefault();
      this.style.display = 'none';
      const ty = document.getElementById('thankYou');
      if (ty) ty.classList.add('show');
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

  // tilt cards (product cards)
  document.querySelectorAll('[data-tilt]').forEach(card => {
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

  // atoll map — global so the inline onclick="selectAtoll(this)" can reach it
  window.selectAtoll = function(el) {
    document.querySelectorAll('.atoll').forEach(a => a.classList.remove('selected'));
    el.classList.add('selected');
    const box = document.getElementById('atollInfo');
    if (!box) return;
    const eyebrow = box.querySelector('.eyebrow2');
    if (eyebrow) eyebrow.textContent = box.dataset.selectedLabel || eyebrow.textContent;
    const h3 = box.querySelector('h3');
    if (h3) h3.textContent = el.dataset.name;
    const p = box.querySelector('p');
    if (p) p.textContent = el.dataset.info;
  };

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

})();
