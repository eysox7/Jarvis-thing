import { h, clear, formatDistance } from '../util.js';
import { t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openSheet, closeSheet, formError, busy, toast } from '../ui.js';

export async function openCompose(app) {
  if (!app.state.user) return app.openAuth(() => openCompose(app));
  const { limits } = app.state.config;

  const error = formError();
  const text = h('textarea', { name: 'text', rows: 4, maxlength: limits.textMax, placeholder: t('compose.placeholder'), required: true });
  const counter = h('span', { class: 'counter' }, `0/${limits.textMax}`);
  text.addEventListener('input', () => {
    const n = [...text.value].length;
    counter.textContent = `${n}/${limits.textMax}`;
    counter.classList.toggle('is-over', n > limits.textMax);
  });
  const where = h('div', { class: 'where' }, h('p', { class: 'muted' }, t('compose.locating')));
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit', disabled: true }, `🎈 ${t('compose.submit')}`);
  const anonymous = h('input', { type: 'checkbox', name: 'anonymous' });
  const ephemeral = h('input', { type: 'checkbox', name: 'ephemeral' });
  const visibilityOption = (value, icon, checked) => h('label', { class: 'place-option' },
    h('input', { type: 'radio', name: 'visibility', value, checked }),
    h('span', { class: 'place-option-name' }, `${icon} ${t(`visibility.${value}`)}`, h('span', { class: 'muted small option-hint' }, t(`visibility.${value}Hint`))));
  const visibility = h('div', { class: 'place-options', role: 'radiogroup' },
    visibilityOption('local', '📍', true),
    visibilityOption('public', '🌍', false));

  let position = null;
  let choice = null; // { placeId } | { newPlaceName: input }

  function renderPlaces(places) {
    clear(where);
    const newName = h('input', { name: 'newPlaceName', maxlength: limits.placeNameMax, placeholder: t('compose.newPlaceName') });
    const options = places.map((p, i) => {
      const radio = h('input', { type: 'radio', name: 'place', value: p.id, checked: i === 0 });
      radio.addEventListener('change', () => { choice = { placeId: p.id }; newName.hidden = true; });
      return h('label', { class: 'place-option' }, radio,
        h('span', { class: 'place-option-name' }, p.name),
        h('span', { class: 'muted' }, formatDistance(p.distance)));
    });
    if (places.length) {
      const radio = h('input', { type: 'radio', name: 'place', value: '' });
      radio.addEventListener('change', () => { choice = { newPlaceName: newName }; newName.hidden = false; newName.focus(); });
      options.push(h('label', { class: 'place-option' }, radio, h('span', { class: 'place-option-name' }, `➕ ${t('compose.newPlace')}`)));
      newName.hidden = true;
      choice = { placeId: places[0].id };
    } else {
      choice = { newPlaceName: newName };
    }
    where.append(
      h('p', { class: 'field-label' }, t('compose.where')),
      places.length ? h('div', { class: 'place-options', role: 'radiogroup' }, options) : h('p', { class: 'muted' }, t('compose.noPlace')),
      newName);
    submit.disabled = false;
  }

  async function locate() {
    clear(where).append(h('p', { class: 'muted' }, t('compose.locating')));
    submit.disabled = true;
    position = await app.currentPosition();
    if (!position) {
      clear(where).append(
        h('p', { class: 'muted' }, t('compose.needLocation')),
        h('button', { class: 'btn', type: 'button', onclick: locate }, `📍 ${t('compose.retryLocation')}`));
      return;
    }
    try {
      const result = await app.checkIn(position, { silent: true });
      if (result.blocked && result.blocked !== 'unlock_burst') {
        clear(where).append(h('p', { class: 'form-error' }, t(`location.${result.blocked}`)));
        return;
      }
      renderPlaces(result.places);
    } catch (err) {
      clear(where).append(h('p', { class: 'form-error' }, errorText(err)));
    }
  }

  const form = h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      error.hide();
      busy(submit, async () => {
        const payload = {
          text: text.value,
          lat: position.lat,
          lng: position.lng,
          accuracy: position.accuracy,
          anonymous: anonymous.checked,
          ephemeral: ephemeral.checked,
          visibility: form.querySelector('input[name="visibility"]:checked')?.value || 'local',
        };
        if (choice?.placeId) payload.placeId = choice.placeId;
        else payload.newPlaceName = choice?.newPlaceName.value || '';
        try {
          const { overheard, newBadges } = await api.post(payload);
          closeSheet();
          toast(overheard.pioneer ? t(overheard.onLine ? 'toast.pioneerLine' : 'toast.pioneer', { place: overheard.placeName }) : t('toast.posted'), { tone: 'success', timeout: overheard.pioneer ? 6000 : 4200 });
          if (overheard.masked?.length) toast(t('toast.masked'));
          app.celebrate(newBadges);
          await app.refresh();
          app.openOverheard(overheard);
        } catch (err) {
          if (err.code === 'place_exists') {
            error.show(t('errors.place_exists', { name: err.data.place.name }));
            renderPlaces([{ ...err.data.place, distance: 0 }]);
          } else {
            error.show(errorText(err));
          }
        }
      });
    },
  },
  h('div', { class: 'quote-input' }, h('span', { class: 'quote-mark', 'aria-hidden': 'true' }, '“'), text),
  h('div', { class: 'row-between' }, h('span', { class: 'muted small' }, t('compose.rules')), counter),
  app.state.config.aiModeration ? h('p', { class: 'muted small' }, `🤖 ${t('compose.aiNote')}`) : null,
  where,
  h('p', { class: 'field-label' }, t('compose.who')),
  visibility,
  h('label', { class: 'check' }, anonymous, h('span', {}, `🎭 ${t('compose.anonymous')}`)),
  h('label', { class: 'check' }, ephemeral, h('span', {}, `⏳ ${t('compose.ephemeral')}`)),
  error.el,
  submit);

  openSheet({ key: 'compose', title: t('compose.title'), body: form });
  setTimeout(() => text.focus(), 50);
  await locate();
}
