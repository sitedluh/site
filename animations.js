/* animations.js — scroll reveal via IntersectionObserver */
(function () {
  'use strict';

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('revealed');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -28px 0px' });

  function mark(el, delayMs) {
    if (el.classList.contains('reveal')) return;
    el.classList.add('reveal');
    if (delayMs) el.style.transitionDelay = delayMs + 'ms';
    io.observe(el);
  }

  function revealCards() {
    document.querySelectorAll('.prod-card:not(.reveal)').forEach(function (el, i) {
      mark(el, Math.min((i % 3) * 70, 180));
    });
  }

  function revealAdmin() {
    document.querySelectorAll('.pedido-card:not(.reveal), .ped-row:not(.reveal)').forEach(function (el, i) {
      mark(el, Math.min(i * 35, 280));
    });
    document.querySelectorAll('.pp-card:not(.reveal)').forEach(function (el, i) {
      mark(el, Math.min(i * 50, 300));
    });
  }

  function init() {
    revealCards();
    revealAdmin();

    document.querySelectorAll('.form-section:not(.reveal)').forEach(function (el, i) {
      mark(el, i * 50);
    });
  }

  /* Observa cards adicionados dinamicamente (produtos carregam via fetch) */
  var mo = new MutationObserver(function () {
    revealCards();
    revealAdmin();
  });
  mo.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
