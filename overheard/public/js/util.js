import { getLang, t } from './i18n.js';

// Güvenli DOM üretici: metinler her zaman text node olarak eklenir, asla HTML olarak yorumlanmaz.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function timeAgo(ms) {
  const diff = Math.max(0, Date.now() - ms);
  const m = Math.floor(diff / 60000);
  if (m < 1) return t('time.now');
  if (m < 60) return t('time.m', { n: m });
  const hours = Math.floor(m / 60);
  if (hours < 24) return t('time.h', { n: hours });
  return t('time.d', { n: Math.floor(hours / 24) });
}

export function formatDate(ms) {
  return new Date(ms).toLocaleDateString(getLang() === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDistance(m) {
  if (m < 1000) return t('dist.m', { n: Math.round(m / 10) * 10 });
  const km = m / 1000;
  return t('dist.km', { n: km.toLocaleString(getLang() === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: km < 10 ? 1 : 0 }) });
}

export function distanceM(aLat, aLng, bLat, bLng) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function truncate(text, max) {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

// Kullanıcı adı ya da (anonimse) "Anonim kulak".
export const displayName = (handle) => (handle ? `@${handle}` : t('anon.name'));

export const BADGE_EMOJI = {
  first_step: '👣', explorer: '🧭', cartographer: '🗺️', two_cities: '✈️', first_drop: '🎈',
  storyteller: '📚', witness: '👂', connector: '🤝', streak: '🔥', pioneer: '🚩',
};

export const REACTION_EMOJI = { lol: '😂', wow: '😮', same: '👂', heart: '❤️' };
