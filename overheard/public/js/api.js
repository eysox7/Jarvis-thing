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
  overheardsInBox: (bbox) => request('GET', `/api/overheards?bbox=${bbox.map((n) => n.toFixed(5)).join(',')}`),
  checkIn: (pos) => request('POST', '/api/checkins', pos),
  myPlaces: () => request('GET', '/api/me/places'),
  overheard: (id) => request('GET', `/api/overheards/${enc(id)}`),
  post: (payload) => request('POST', '/api/overheards', payload),
  remove: (id) => request('DELETE', `/api/overheards/${enc(id)}`),
  react: (id, kind) => request('POST', `/api/overheards/${enc(id)}/reactions`, { kind }),
  report: (id, reason) => request('POST', `/api/overheards/${enc(id)}/report`, { reason }),
  messageAbout: (id, body, to) => request('POST', `/api/overheards/${enc(id)}/messages`, { body, to }),
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
  adminBan: (handle, banned) => request('POST', `/api/admin/users/${enc(handle)}/ban`, { banned }),
};
