// Görsel parçalar: hologram avatar, DNA radarı, senkron halkası, modal.
import { esc, hash, $ } from './util.js';
import { TRAITS, dna } from './clone.js';

export function avatar(c, size = 56, cls = '') {
  const h = c.hue ?? 190;
  const s = hash(String(c.id || c.name));
  const g = 'g' + s.toString(36);
  const fins = s % 3, eye = 2 + (s >> 3) % 3, stripe = (s >> 5) % 4;
  const stripes = Array.from({ length: stripe }, (_, i) =>
    `<rect x="${22 + i * 7}" y="40" width="4" height="10" rx="1" fill="hsl(${h} 100% 85% / .55)"/>`).join('');
  const fin = fins === 0 ? '' : fins === 1
    ? `<path d="M32 2 L35 9 L29 9 Z" fill="hsl(${h} 100% 75%)"/>`
    : `<rect x="7" y="22" width="4" height="16" rx="2" fill="hsl(${h} 100% 75%)"/><rect x="53" y="22" width="4" height="16" rx="2" fill="hsl(${h} 100% 75%)"/>`;
  return `<svg class="ava ${cls}" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h} 90% 72%)"/><stop offset="1" stop-color="hsl(${h} 85% 30%)"/></linearGradient></defs>
    ${fin}
    <path d="M12 30C12 15 21 8 32 8s20 7 20 22v14c0 8-7 13-20 13S12 52 12 44Z" fill="url(#${g})" stroke="hsl(${h} 100% 85%)" stroke-width="1.2"/>
    <rect x="16" y="24" width="32" height="10" rx="5" fill="#060a16"/>
    <circle cx="${32 - eye * 3}" cy="29" r="2.2" fill="hsl(${(h + 180) % 360} 100% 70%)"/><circle cx="${32 + eye * 3}" cy="29" r="2.2" fill="hsl(${(h + 180) % 360} 100% 70%)"/>
    ${stripes}
  </svg>`;
}

/** Bir veya iki klonun DNA'sını üst üste çizen radar. */
export function radar(clones, size = 260) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 34, n = TRAITS.length;
  const pt = (i, r) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  const rings = [0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${TRAITS.map((_, i) => pt(i, R * f).join(',')).join(' ')}" class="ring"/>`).join('');
  const axes = TRAITS.map((t, i) => {
    const [x, y] = pt(i, R), [lx, ly] = pt(i, R + 18);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="axis"/><text x="${lx}" y="${ly}" class="lbl" text-anchor="middle" dominant-baseline="middle">${t.short}</text>`;
  }).join('');
  const shapes = clones.map((c, k) => {
    const d = dna(c);
    const pts = d.map((v, i) => pt(i, R * (0.12 + 0.88 * (v + 1) / 2)).join(',')).join(' ');
    const col = `hsl(${c.hue ?? 190} 100% 65%)`;
    return `<polygon points="${pts}" fill="${col}" fill-opacity="${k ? 0.18 : 0.28}" stroke="${col}" stroke-width="2"/>`;
  }).join('');
  return `<svg class="radar" viewBox="0 0 ${size} ${size}" width="100%" style="max-width:${size}px">${rings}${axes}${shapes}</svg>`;
}

export function ring(value, label = 'SENKRON', size = 120) {
  const r = 50, C = 2 * Math.PI * r, v = value ?? 0;
  const col = value == null ? 'var(--dim)' : v >= 0.75 ? 'var(--ok)' : v >= 0.6 ? 'var(--cyan)' : 'var(--red)';
  return `<svg class="ringv" viewBox="0 0 120 120" width="${size}" height="${size}">
    <circle cx="60" cy="60" r="${r}" class="track"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${C * v} ${C}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" text-anchor="middle" class="ring-num">${value == null ? '—' : Math.round(v * 100) + '%'}</text>
    <text x="60" y="78" text-anchor="middle" class="ring-lbl">${esc(label)}</text></svg>`;
}

export function modal(html) {
  const m = $('#modal');
  $('#modalBody').innerHTML = html;
  m.hidden = false;
  return m;
}
export const closeModal = () => { $('#modal').hidden = true; };

export const cloneChip = (c, extra = '') =>
  `<div class="chip">${avatar(c, 40)}<div><b>${esc(c.name)}</b><div class="mono dim">${esc(c.code || '')}${extra}</div></div></div>`;
