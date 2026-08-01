/**
 * Marketing site behavior: lead form submission and scroll reveals.
 * Everything here is progressive enhancement; the page is fully readable
 * and the anchors all work with JavaScript disabled.
 */

const form = document.getElementById('lead-form');

if (form) {
  const statusEl = form.querySelector('.form-status');
  const submitBtn = form.querySelector('button[type="submit"]');

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', Boolean(isError));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    const data = Object.fromEntries(new FormData(form).entries());

    submitBtn.disabled = true;
    setStatus('Sending…', false);

    try {
      const response = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Something went wrong. Please try again.');
      }

      form.classList.add('is-done');
      setStatus(
        `Thanks, ${data.name.trim().split(/\s+/)[0]}. We got it and will email ${data.email.trim()} to set up a walkthrough.`,
        false
      );
    } catch (err) {
      submitBtn.disabled = false;
      setStatus(err.message, true);
    }
  });
}

/* Scroll reveals: applied only when JS runs, so content is never hidden
   without it. Skipped entirely under prefers-reduced-motion. */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reduceMotion && 'IntersectionObserver' in window) {
  const revealables = document.querySelectorAll('.reveal');

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal-in');
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px' }
  );

  for (const el of revealables) {
    // Elements already in the viewport at load stay visible; no pop-in.
    if (el.getBoundingClientRect().top < window.innerHeight) continue;
    el.classList.add('reveal-pending');
    observer.observe(el);
  }
}
