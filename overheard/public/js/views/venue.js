import { h, clear, timeAgo } from '../util.js';
import { t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, busy, toast } from '../ui.js';

// Kafe paneli (garson/kasa): müşteri "overheard istiyorum" deyince masa açılır, gerisini sistem
// yapar: söz seçer, masa numarasıyla yazıcıya gönderir, masa açık kaldıkça aralıklarla yenisini basar.
export async function openVenue(app, venue) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('common.loading')));
  openSheet({ key: `venue:${venue.placeId}`, title: `☕ ${venue.name}`, body });
  try {
    render(body, venue.placeId, await api.venue(venue.placeId));
  } catch (err) {
    clear(body).append(h('p', { class: 'form-error' }, errorText(err)));
  }
}

function render(body, placeId, state) {
  const rerender = (next) => render(body, placeId, next);
  const run = (button, fn, done) => busy(button, async () => {
    try {
      const next = await fn();
      rerender(next.state ?? next);
      if (done) toast(typeof done === 'function' ? done(next) : done, { tone: 'success' });
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
    }
  });
  const act = (fn, done) => (e) => run(e.currentTarget, fn, done);

  const { venue, tables, available } = state;
  const modeOption = (value) => h('label', { class: 'place-option' },
    h('input', {
      type: 'radio',
      name: 'venue-mode',
      value,
      checked: venue.mode === value,
      onchange: async () => {
        try {
          rerender(await api.venueSettings(placeId, { mode: value }));
          toast(t('venue.modeSaved'));
        } catch (err) {
          toast(errorText(err), { tone: 'error' });
        }
      },
    }),
    h('span', { class: 'place-option-name' }, t(`venue.mode.${value}`), h('span', { class: 'muted small option-hint' }, t(`venue.mode.${value}Hint`, { km: (venue.nearbyM / 1000).toLocaleString() }))));

  const tableInput = h('input', { name: 'tableNo', maxlength: 12, placeholder: t('venue.tablePlaceholder'), 'aria-label': t('venue.tableNo'), autocomplete: 'off', required: true });
  const openButton = h('button', { class: 'btn btn-primary', type: 'submit' }, t('venue.open'));
  const openForm = h('form', {
    class: 'qr-search',
    onsubmit: (e) => {
      e.preventDefault();
      const tableNo = tableInput.value.trim();
      if (!tableNo) return;
      run(openButton, () => api.venueOpenTable(placeId, tableNo), (r) => t(r.queued ? 'venue.opened' : 'venue.openedEmpty', { n: tableNo }));
    },
  }, tableInput, openButton);

  clear(body).append(
    h('p', { class: 'muted small' }, t('venue.how')),
    h('h3', { class: 'section-title' }, t('venue.openTitle')),
    openForm,
    h('h3', { class: 'section-title' }, t('venue.tables', { n: tables.length })),
    tables.length
      ? h('ul', { class: 'list' }, tables.map((tb) => h('li', { class: 'admin-item venue-table' },
        h('p', { class: 'row-between' },
          h('strong', { class: 'venue-table-no' }, t('venue.table', { n: tb.tableNo })),
          h('span', { class: 'muted small' }, `${t('venue.slips', { printed: tb.printed, pending: tb.pending })} · ${timeAgo(tb.openedAt)}`)),
        h('div', { class: 'bubble-actions' },
          h('button', { class: 'btn', type: 'button', onclick: act(() => api.venuePrint(placeId, tb.id), t('venue.sent')) }, `🖨️ ${t('venue.another')}`),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: act(() => api.venueCloseTable(placeId, tb.id), t('venue.closed', { n: tb.tableNo })) }, t('venue.close'))))))
      : h('p', { class: 'empty' }, t('venue.noTables')),
    h('p', { class: available ? 'muted small' : 'form-error' }, available ? t('venue.available', { n: available }) : t('venue.noContent')),
    h('h3', { class: 'section-title' }, t('venue.modeTitle')),
    h('div', { class: 'place-options', role: 'radiogroup' }, modeOption('inside'), modeOption('nearby')),
    h('p', { class: 'muted small' }, t('venue.every', { min: venue.everyMin, n: venue.perTable })),
    h('a', { class: 'btn btn-block', href: `/yazici.html?place=${encodeURIComponent(placeId)}`, target: '_blank', rel: 'noopener' }, `🖨️ ${t('venue.printer')}`),
    h('p', { class: 'muted small' }, t('venue.printerHint')));
}
