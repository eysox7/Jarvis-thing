import { h, clear, timeAgo, displayName } from '../util.js';
import { t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, toast, busy } from '../ui.js';
import { downloadBlob, downloadQrPoster } from '../share.js';

// Moderasyon paneli: şikâyet edilen ve otomatik gizlenen sözler.
export async function openAdmin(app) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('common.loading')));
  openSheet({ key: 'admin', title: `🛡️ ${t('admin.title')}`, body });

  let items;
  let ai;
  let flagged;
  let venues;
  try {
    [{ overheards: items, ai }, { users: flagged }, { venues }] = await Promise.all([api.adminReports(), api.adminLocationFlags(), api.adminVenues()]);
  } catch (err) {
    clear(body).append(h('p', { class: 'form-error' }, errorText(err)));
    return;
  }
  clear(body);
  body.append(h('p', { class: 'muted small' }, ai?.enabled ? t('admin.ai', ai) : t('admin.aiOff')), venueSection(app, venues), qrSection(app));
  if (flagged.length) {
    body.append(
      h('h3', { class: 'section-title' }, `📍 ${t('admin.locationFlags')}`),
      h('ul', { class: 'list' }, flagged.map((u) => h('li', { class: 'admin-item' },
        h('p', { class: 'row-between' }, h('strong', {}, `@${u.handle}`), h('span', { class: 'chip chip-hot' }, t('admin.flags', { n: u.flags }))),
        h('p', { class: 'muted small' }, `${timeAgo(u.lastAt)} · ${u.last}`),
        h('div', { class: 'bubble-actions' },
          h('button', {
            class: 'btn btn-ghost',
            type: 'button',
            onclick: (e) => busy(e.currentTarget, async () => {
              await api.adminBan(u.handle, !u.banned);
              toast(u.banned ? t('admin.unbanned') : t('admin.bannedToast'));
              await openAdmin(app);
            }),
          }, u.banned ? t('admin.unban') : t('admin.ban')))))),
      h('h3', { class: 'section-title' }, `🚩 ${t('admin.title')}`));
  }
  if (!items.length) {
    body.append(h('p', { class: 'empty' }, `✅ ${t('admin.empty')}`));
    return;
  }

  const act = (fn, done) => (e) => busy(e.currentTarget, async () => {
    try {
      await fn();
      toast(done);
      await app.refresh();
      await openAdmin(app);
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
  });

  body.append(h('ul', { class: 'list' }, items.map((o) => h('li', { class: 'admin-item' },
    h('blockquote', { class: 'chat-quote' }, o.text),
    h('p', { class: 'muted small' }, [
      displayName(o.author) + (o.anonymous ? ` (${t('anon.name')})` : ''),
      o.placeName,
      timeAgo(o.createdAt),
      t('admin.reports', { n: o.reports }),
      o.reasons.length ? o.reasons.join(', ') : null,
    ].filter(Boolean).join(' · ')),
    h('div', { class: 'bubble-badges' },
      o.hidden ? h('span', { class: 'chip chip-hot' }, t('admin.hidden')) : null,
      o.authorBanned ? h('span', { class: 'chip' }, t('admin.banned')) : null),
    h('div', { class: 'bubble-actions' },
      h('button', { class: 'btn', type: 'button', onclick: act(() => api.adminRestore(o.id), t('admin.restored')) }, t('admin.restore')),
      h('button', { class: 'btn btn-ghost btn-danger', type: 'button', onclick: act(() => api.adminDelete(o.id), t('toast.deleted')) }, t('bubble.delete')),
      h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        onclick: act(() => api.adminBan(o.author, !o.authorBanned), o.authorBanned ? t('admin.unbanned') : t('admin.bannedToast')),
      }, o.authorBanned ? t('admin.unban') : t('admin.ban')))))));
}

// Mekân QR posterleri: kapalı alanlı ortak mekânların (kafe, kütüphane, kampüs) girişine asılır.
function qrSection(app) {
  const results = h('div', { class: 'stack' });
  const input = h('input', { class: 'input', type: 'search', name: 'qr-place', placeholder: t('admin.qrSearch'), 'aria-label': t('admin.qrSearch'), autocomplete: 'off' });

  const show = async (place, item) => {
    try {
      const { url, svg, matrix } = await api.adminPlaceQr(place.id);
      const city = app.state.config.cities.find((c) => c.id === place.cityId)?.name;
      item.querySelector('.qr-preview')?.remove();
      item.append(h('div', { class: 'qr-preview' },
        h('img', { class: 'qr-image', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt: t('admin.qrAlt', { place: place.name }), width: 220, height: 220 }),
        h('input', { class: 'input qr-url', type: 'text', readonly: true, value: url, 'aria-label': t('admin.qrUrl'), onfocus: (e) => e.currentTarget.select() }),
        h('div', { class: 'bubble-actions' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => busy(e.currentTarget, () => downloadQrPoster(place, city, matrix, url)) }, `🖨️ ${t('admin.qrPoster')}`),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `overheard-qr-${place.id}.svg`) }, t('admin.qrSvg')))));
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
  };

  const search = async () => {
    const q = input.value.trim();
    if (q.length < 2) return;
    try {
      const { places } = await api.adminPlaces(q);
      clear(results).append(places.length
        ? h('ul', { class: 'list' }, places.map((p) => {
          const item = h('li', { class: 'admin-item' });
          const city = app.state.config.cities.find((c) => c.id === p.cityId)?.name || p.cityId;
          item.append(h('p', { class: 'row-between' },
            h('span', {}, h('strong', {}, p.name), h('span', { class: 'muted small' }, ` · ${city}`)),
            h('span', { class: 'bubble-actions' },
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
              try {
                await api.adminSaveVenue(p.id);
                toast(t('admin.cafeMade', { place: p.name }), { tone: 'success' });
                await openAdmin(app);
              } catch (err) {
                toast(errorText(err), { tone: 'error' });
              }
            }) }, `☕ ${t('admin.makeCafe')}`),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: (e) => busy(e.currentTarget, () => show(p, item)) }, `📮 ${t('admin.qrShow')}`))));
          return item;
        }))
        : h('p', { class: 'muted' }, t('admin.qrNone')));
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
  };

  const form = h('form', { class: 'qr-search', onsubmit: (e) => { e.preventDefault(); search(); } },
    input, h('button', { class: 'btn', type: 'submit' }, t('admin.qrFind')));
  return h('section', { class: 'stack' },
    h('h3', { class: 'section-title' }, `📮 ${t('admin.qrTitle')}`),
    h('p', { class: 'muted small' }, t('admin.qrHint')),
    form,
    results);
}

// Overheard Kafeler: personel (garson/kasa hesapları) ve kafeliği kaldırma. Yeni kafe, aşağıdaki
// mekân aramasından "Kafe yap" ile eklenir.
function venueSection(app, venues) {
  const act = (fn) => (e) => busy(e.currentTarget, async () => {
    try {
      await fn();
      await openAdmin(app);
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
  });
  return h('section', { class: 'stack' },
    h('h3', { class: 'section-title' }, `☕ ${t('admin.cafes')}`),
    venues.length
      ? h('ul', { class: 'list' }, venues.map((v) => {
        const handle = h('input', { name: 'staff', placeholder: t('admin.staffHandle'), 'aria-label': t('admin.staffHandle'), autocomplete: 'off' });
        const add = h('button', { class: 'btn', type: 'submit' }, t('admin.addStaff'));
        return h('li', { class: 'admin-item' },
          h('p', { class: 'row-between' },
            h('strong', {}, v.name),
            h('span', { class: 'muted small' }, t(`venue.mode.${v.mode}`))),
          h('div', { class: 'bubble-badges' }, v.staff.length
            ? v.staff.map((s) => h('span', { class: 'chip' }, `@${s} `,
              h('button', { class: 'chip-x', type: 'button', 'aria-label': t('admin.removeStaff', { handle: s }), onclick: act(() => api.adminRemoveStaff(v.placeId, s)) }, '✕')))
            : h('span', { class: 'muted small' }, t('admin.noStaff'))),
          h('form', { class: 'qr-search', onsubmit: (e) => { e.preventDefault(); if (handle.value.trim()) act(() => api.adminAddStaff(v.placeId, handle.value.trim()))({ currentTarget: add }); } }, handle, add),
          h('div', { class: 'bubble-actions' },
            h('button', { class: 'btn btn-ghost btn-danger', type: 'button', onclick: act(() => api.adminRemoveVenue(v.placeId)) }, t('admin.removeCafe'))));
      }))
      : h('p', { class: 'muted small' }, t('admin.noCafes')));
}
