// /connect page: copy-to-clipboard for the snippet and curl walkthrough.
// textContent-only — no innerHTML anywhere.
for (const btn of document.querySelectorAll('.copy-btn[data-copy]')) {
  btn.addEventListener('click', () => {
    const el = document.getElementById(btn.dataset.copy);
    if (!el) return;
    const text = el.textContent;
    const done = ok => {
      const label = btn.firstChild;
      if (label && label.nodeType === 3) label.textContent = ok ? 'COPIED ✓ ' : 'COPY FAILED ';
      setTimeout(() => { if (label && label.nodeType === 3) label.textContent = 'COPY '; }, 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.append(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); done(ok);
    }
  });
}