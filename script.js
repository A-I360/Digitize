const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

// Reveal content and animate metrics only once when it enters the viewport.
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('visible');
    entry.target.querySelectorAll('[data-count]').forEach(counter => {
      if (counter.dataset.done) return;
      counter.dataset.done = 'true';
      const end = Number(counter.dataset.count), suffix = counter.dataset.suffix || '';
      const start = performance.now(), duration = 1200;
      const tick = now => {
        const value = Math.min(1, (now - start) / duration);
        counter.textContent = Math.floor((1 - Math.pow(1 - value, 3)) * end) + suffix;
        if (value < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    revealObserver.unobserve(entry.target);
  });
}, { threshold: .13 });
$$('.reveal').forEach(el => revealObserver.observe(el));

// Mobile navigation
const toggle = $('.menu-toggle'), links = $('.nav-links');
toggle.addEventListener('click', () => {
  const open = links.classList.toggle('open');
  toggle.setAttribute('aria-expanded', open);
});
$$('.nav-links a').forEach(link => link.addEventListener('click', () => links.classList.remove('open')));

// Keep navigation context visible while scrolling.
const sections = $$('main section[id]');
const navLinks = $$('.nav-links a');
const navObserver = new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.isIntersecting) navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === '#' + entry.target.id));
}), { rootMargin: '-35% 0px -55% 0px' });
sections.forEach(section => navObserver.observe(section));

// Theme setting respects current preference, but is always user controllable.
const themeButton = $('.theme-toggle');
if (localStorage.getItem('synq-theme') === 'dark') document.body.classList.add('dark');
themeButton.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('synq-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

// Pricing currency switcher between Naira and US Dollar; the choice is remembered between visits.
const currencyButtons = $$('.currency-switch button');
const priceAmounts = $$('.price-amount[data-ngn][data-usd]');
const setCurrency = currency => {
  currencyButtons.forEach(button => {
    const active = button.dataset.currency === currency;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
  priceAmounts.forEach(amount => { amount.textContent = amount.dataset[currency]; });
  localStorage.setItem('synq-currency', currency);
};
currencyButtons.forEach(button => button.addEventListener('click', () => setCurrency(button.dataset.currency)));
const savedCurrency = localStorage.getItem('synq-currency');
if (savedCurrency === 'ngn' || savedCurrency === 'usd') setCurrency(savedCurrency);

const backTop = $('.back-top');
window.addEventListener('scroll', () => backTop.classList.toggle('show', scrollY > 650), { passive: true });
backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// Gentle pointer glow and magnetic buttons, disabled for coarse pointers.
if (matchMedia('(pointer:fine)').matches) {
  const glow = $('.cursor-glow');
  window.addEventListener('pointermove', e => { glow.style.left = e.clientX + 'px'; glow.style.top = e.clientY + 'px'; }, { passive: true });
  $$('.magnetic').forEach(button => {
    button.addEventListener('pointermove', e => {
      const r = button.getBoundingClientRect();
      button.style.transform = `translate(${(e.clientX-r.left-r.width/2)*.12}px,${(e.clientY-r.top-r.height/2)*.12}px)`;
    });
    button.addEventListener('pointerleave', () => button.style.transform = '');
  });
}

// Hand the enquiry straight to WhatsApp instead of pretending to submit it somewhere.
const WHATSAPP_NUMBER = '2348162903238';
$('.contact-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const lines = [
    `Hi Synq Digital, I'd like to start a project.`,
    `Name: ${data.get('name')}`,
    `Email: ${data.get('email')}`,
    `Project type: ${data.get('type')}`,
    `Budget: ${data.get('budget')}`,
    data.get('message') ? `Details: ${data.get('message')}` : null,
  ].filter(Boolean);
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
  $('.form-success').textContent = 'Opening WhatsApp with your project details — send the message to reach us.';
  event.currentTarget.reset();
});
$('.newsletter form').addEventListener('submit', event => { event.preventDefault(); event.currentTarget.reset(); });
