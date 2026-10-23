export class ApiError extends Error {
  constructor(status, code, data = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, ...rest } = data;
    throw new ApiError(res.status, error || 'default', rest);
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  config: () => request('GET', '/api/config'),
  me: () => request('GET', '/api/me'),
  register: (handle, password, acceptTerms) => request('POST', '/api/auth/register', { handle, password, acceptTerms }),
  deleteAccount: (password) => request('POST', '/api/me/delete', { password }),
  login: (handle, password) => request('POST', '/api/auth/login', { handle, password }),
  guest: () => request('POST', '/api/auth/guest', {}),
  upgrade: (handle, password) => request('POST', '/api/auth/upgrade', { handle, password }),
  logout: () => request('POST', '/api/auth/logout', {}),
  cityMap: (cityId) => request('GET', `/api/cities/${enc(cityId)}/map`),
  best: (cityId) => request('GET', `/api/cities/${enc(cityId)}/best`),
  overheardsInBox: (bbox) => request('GET', `/api/overheards?bbox=${bbox.map((n) => n.toFixed(5)).join(',')}`),
  checkIn: (pos) => request('POST', '/api/checkins', pos),
  qrCheckIn: (code, pos) => request('POST', '/api/checkins/qr', { code, ...pos }),
  // Çevrimdışı yazılmış söz (cihazdaki kuyruktan).
  postOffline: (item) => request('POST', '/api/overheards/offline', {
    clientId: item.clientId, author: item.author, text: item.text, placeId: item.placeId, visibility: item.visibility,
    anonymous: item.anonymous, ephemeral: item.ephemeral, heardAt: item.heardAt, fix: item.fix,
  }),
  relay: (payload) => request('POST', '/api/overheards/relay', payload),
  myPlaces: () => request('GET', '/api/me/places'),
  overheard: (id) => request('GET', `/api/overheards/${enc(id)}`),
  post: (payload) => request('POST', '/api/overheards', payload),
  remove: (id) => request('DELETE', `/api/overheards/${enc(id)}`),
  react: (id, kind) => request('POST', `/api/overheards/${enc(id)}/reactions`, { kind }),
  report: (id, reason) => request('POST', `/api/overheards/${enc(id)}/report`, { reason }),
  messageAbout: (id, body, to) => request('POST', `/api/overheards/${enc(id)}/messages`, { body, to }),
  room: (placeId) => request('GET', `/api/places/${enc(placeId)}/room`),
  roomPost: (placeId, body) => request('POST', `/api/places/${enc(placeId)}/room`, { body }),
  conversations: () => request('GET', '/api/conversations'),
  conversation: (id, before) => request('GET', `/api/conversations/${enc(id)}${before ? `?before=${enc(before)}` : ''}`),
  reply: (id, body) => request('POST', `/api/conversations/${enc(id)}/messages`, { body }),
  block: (handle) => request('POST', `/api/users/${enc(handle)}/block`, {}),
  blockAuthor: (id) => request('POST', `/api/overheards/${enc(id)}/block-author`, {}),
  reveal: (id) => request('POST', `/api/conversations/${enc(id)}/reveal`, {}),
  adminReports: () => request('GET', '/api/admin/reports'),
  adminLocationFlags: () => request('GET', '/api/admin/location-flags'),
  adminRestore: (id) => request('POST', `/api/admin/overheards/${enc(id)}/restore`, {}),
  adminDelete: (id) => request('DELETE', `/api/admin/overheards/${enc(id)}`),
  adminPlaces: (q) => request('GET', `/api/admin/places?q=${enc(q)}`),
  adminPlaceQr: (id) => request('GET', `/api/admin/places/${enc(id)}/qr`),
  adminVenues: () => request('GET', '/api/admin/venues'),
  adminSaveVenue: (placeId, settings = {}) => request('POST', `/api/admin/venues/${enc(placeId)}`, settings),
  adminRemoveVenue: (placeId) => request('DELETE', `/api/admin/venues/${enc(placeId)}`),
  adminAddStaff: (placeId, handle) => request('POST', `/api/admin/venues/${enc(placeId)}/staff`, { handle }),
  adminRemoveStaff: (placeId, handle) => request('DELETE', `/api/admin/venues/${enc(placeId)}/staff/${enc(handle)}`),
  venue: (placeId) => request('GET', `/api/venues/${enc(placeId)}`),
  venueSettings: (placeId, settings) => request('POST', `/api/venues/${enc(placeId)}/settings`, settings),
  venueOpenTable: (placeId, tableNo) => request('POST', `/api/venues/${enc(placeId)}/tables`, { tableNo }),
  venuePrint: (placeId, tableId) => request('POST', `/api/venues/${enc(placeId)}/tables/${enc(tableId)}/print`, {}),
  venueCloseTable: (placeId, tableId) => request('POST', `/api/venues/${enc(placeId)}/tables/${enc(tableId)}/close`, {}),
  venueJobs: (placeId) => request('GET', `/api/venues/${enc(placeId)}/jobs`),
  venuePrinted: (placeId, jobId) => request('POST', `/api/venues/${enc(placeId)}/jobs/${enc(jobId)}/printed`, {}),
  adminBan: (handle, banned) => request('POST', `/api/admin/users/${enc(handle)}/ban`, { banned }),
};
