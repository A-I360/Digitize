const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('visible');
    entry.target.querySelectorAll('[data-count]').forEach(counter => {
      if (counter.dataset.done) return;
      counter.dataset.done = 'true';
      const end = Number(counter.dataset.count);
      const suffix = counter.dataset.suffix || '';
      if (prefersReducedMotion) {
        counter.textContent = end + suffix;
        return;
      }
      const start = performance.now();
      const duration = 1200;
      const tick = now => {
        const value = Math.min(1, (now - start) / duration);
        counter.textContent = Math.floor((1 - Math.pow(1 - value, 3)) * end) + suffix;
        if (value < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    revealObserver.unobserve(entry.target);
  });
}, { threshold: 0.13 });
$$('.reveal').forEach(el => revealObserver.observe(el));

const toggle = $('.menu-toggle');
const links = $('.nav-links');
const closeMenu = () => {
  if (!links || !toggle) return;
  links.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
};
if (toggle && links) {
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  $$('.nav-links a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  document.addEventListener('click', e => {
    if (!e.target.closest('.nav')) closeMenu();
  });
}

const sections = $$('main section[id], header[id]');
const navLinks = $$('.nav-links a');
const setActive = id => {
  navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === '#' + id));
};
const navObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) setActive(entry.target.id);
  });
}, { rootMargin: '-40% 0px -50% 0px', threshold: 0 });
sections.forEach(section => navObserver.observe(section));
window.addEventListener('scroll', () => {
  if (scrollY < 80) setActive('home');
}, { passive: true });

const themeButton = $('.theme-toggle');
const themeColor = $('meta[name="theme-color"]');
const applyTheme = dark => {
  document.body.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('dark', dark);
  if (themeColor) themeColor.setAttribute('content', dark ? '#0d1525' : '#ffffff');
  if (themeButton) {
    themeButton.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    themeButton.setAttribute('aria-pressed', String(dark));
  }
};
const savedTheme = localStorage.getItem('synq-theme');
const initialDark = savedTheme
  ? savedTheme === 'dark'
  : matchMedia('(prefers-color-scheme: dark)').matches;
applyTheme(initialDark);
if (themeButton) {
  themeButton.addEventListener('click', () => {
    const dark = !document.body.classList.contains('dark');
    applyTheme(dark);
    localStorage.setItem('synq-theme', dark ? 'dark' : 'light');
  });
}

const currencyButtons = $$('.currency-switch button');
const priceAmounts = $$('.price-amount[data-ngn][data-usd]');
const setCurrency = currency => {
  currencyButtons.forEach(button => {
    const active = button.dataset.currency === currency;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  priceAmounts.forEach(amount => { amount.textContent = amount.dataset[currency]; });
  localStorage.setItem('synq-currency', currency);
};
currencyButtons.forEach(button => button.addEventListener('click', () => setCurrency(button.dataset.currency)));
const savedCurrency = localStorage.getItem('synq-currency');
if (savedCurrency === 'ngn' || savedCurrency === 'usd') setCurrency(savedCurrency);

const backTop = $('.back-top');
if (backTop) {
  window.addEventListener('scroll', () => backTop.classList.toggle('show', scrollY > 650), { passive: true });
  backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' }));
}

function initCursor() {
  const glow = $('.cursor-glow');
  const ring = $('.cursor-ring');
  const dot = $('.cursor-dot');
  if (!ring || !dot) return;
  document.body.classList.add('has-cursor');
  let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;
  ring.classList.add('on');
  dot.classList.add('on');
  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    mx = e.clientX;
    my = e.clientY;
    if (glow) {
      glow.style.left = mx + 'px';
      glow.style.top = my + 'px';
    }
    dot.style.left = mx + 'px';
    dot.style.top = my + 'px';
  }, { passive: true });
  const loopCursor = () => {
    rx += (mx - rx) * 0.2;
    ry += (my - ry) * 0.2;
    ring.style.left = rx + 'px';
    ring.style.top = ry + 'px';
    requestAnimationFrame(loopCursor);
  };
  loopCursor();
  const hoverSel = 'a, button, input, select, textarea, summary, .lab-card, .service-card, .price-card';
  document.addEventListener('pointerover', e => {
    if (e.target.closest(hoverSel)) ring.classList.add('hover');
  });
  document.addEventListener('pointerout', e => {
    if (e.target.closest(hoverSel)) ring.classList.remove('hover');
  });
}

if (!prefersReducedMotion) {
  initCursor();
  $$('.magnetic').forEach(button => {
    button.addEventListener('pointermove', e => {
      const r = button.getBoundingClientRect();
      button.style.transform = 'translate(' + ((e.clientX - r.left - r.width / 2) * 0.12) + 'px,' + ((e.clientY - r.top - r.height / 2) * 0.12) + 'px)';
    });
    button.addEventListener('pointerleave', () => { button.style.transform = ''; });
  });
  $$('.tilt').forEach(card => {
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.style.transform = 'rotateX(' + ((0.5 - y) * 8) + 'deg) rotateY(' + ((x - 0.5) * 10) + 'deg)';
    });
    card.addEventListener('pointerleave', () => { card.style.transform = ''; });
  });
}



const canvas = $('.neural-canvas');
if (canvas && !prefersReducedMotion) {
  const ctx = canvas.getContext('2d');
  const nodes = Array.from({ length: 42 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
  }));
  const drawNet = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(11,95,255,0.22)';
    ctx.fillStyle = 'rgba(0,212,255,0.85)';
    nodes.forEach(n => {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
      if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    });
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const d = Math.hypot(dx, dy);
        if (d < 110) {
          ctx.globalAlpha = 1 - d / 110;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
    requestAnimationFrame(drawNet);
  };
  drawNet();
}

const WHATSAPP_NUMBER = '2349071618499';
const contactForm = $('.contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const lines = [
      'Hi SYNQ Technological Services, I would like to start a project.',
      'Name: ' + data.get('name'),
      'Email: ' + data.get('email'),
      'Project type: ' + data.get('type'),
      'Budget: ' + data.get('budget'),
    ];
    if (data.get('message')) lines.push('Details: ' + data.get('message'));
    window.open('https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');
    const success = $('.form-success');
    if (success) success.textContent = 'Opening WhatsApp with your project details — send the message to reach us.';
    form.reset();
  });
}

const newsForm = $('.newsletter form');
if (newsForm) {
  newsForm.addEventListener('submit', event => {
    event.preventDefault();
    const input = newsForm.querySelector('input');
    if (!input || !input.value.trim()) return;
    input.value = '';
    input.placeholder = 'Thanks — we will be in touch';
  });
}
