'use strict';

/*
 * Shared login gate for index.html and editor.html, backed by memoqBe's JWT auth
 * (POST /api/v1/auth/login). The token lives in sessionStorage, so logging in on either
 * page carries over to the other (same tab) without a second prompt, and clears when the
 * tab closes. Replaces the old nginx HTTP Basic Auth, which is now removed from k8s/
 * nginx-auth-configmap.yaml — this is the only login gate for the site now.
 */
const MemoqAuth = (() => {
  // Swap this for 'http://localhost:8080/api/v1' when testing against a local
  // `./gradlew bootRun` backend instead of the deployed one at am.neuromancerdream.com.
  const API_BASE = 'https://am.neuromancerdream.com/api/v1';
  const TOKEN_KEY = 'memoq_admin_token';

  let onAuthenticated = null;
  let modalEl, formEl, usernameEl, passwordEl, errorEl, submitBtn;

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function isAuthenticated() {
    return !!getToken();
  }

  async function apiFetch(path, options) {
    options = options || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    const res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));

    if (res.status === 401) {
      clearToken();
      showModal('Session expired. Please log in again.');
      throw new Error('Not authenticated.');
    }
    if (!res.ok) {
      let message = 'Request failed (' + res.status + ').';
      try {
        const body = await res.json();
        message = body.message || message;
      } catch (e) {
        /* non-JSON error body, keep the generic message */
      }
      throw new Error(message);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function injectMarkup() {
    if (document.getElementById('memoqAuthModal')) return;

    const style = document.createElement('style');
    // styles.css only styles input[type="text"]/select/textarea inside .editor-form; the
    // login form needs a password field too.
    style.textContent =
      '#memoqAuthModal .editor-form input[type="password"] {' +
      'background:#06070c;border:1px solid var(--border-dim);border-radius:2px;' +
      'color:#e8faff;font-family:var(--font-mono);font-size:12px;padding:8px 10px;}' +
      '#memoqAuthModal .editor-form input[type="password"]:focus {' +
      'outline:none;border-color:var(--cyan);box-shadow:0 0 6px rgba(0,240,255,0.35);}';
    document.head.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div class="modal-overlay" id="memoqAuthModal" hidden>' +
        '<div class="modal form-modal">' +
          '<h2 class="modal-title form-modal-title">CYBER-BREACH LOGIN</h2>' +
          '<form class="editor-form" id="memoqAuthForm">' +
            '<label class="form-field">' +
              '<span class="field-label">USERNAME</span>' +
              '<input type="text" id="memoqAuthUsername" autocomplete="username">' +
            '</label>' +
            '<label class="form-field">' +
              '<span class="field-label">PASSWORD</span>' +
              '<input type="password" id="memoqAuthPassword" autocomplete="current-password">' +
            '</label>' +
            '<p class="form-error" id="memoqAuthError" hidden></p>' +
            '<div class="form-actions">' +
              '<button type="submit" class="modal-btn" id="memoqAuthSubmit">LOG IN</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrapper.firstElementChild);

    modalEl = document.getElementById('memoqAuthModal');
    formEl = document.getElementById('memoqAuthForm');
    usernameEl = document.getElementById('memoqAuthUsername');
    passwordEl = document.getElementById('memoqAuthPassword');
    errorEl = document.getElementById('memoqAuthError');
    submitBtn = document.getElementById('memoqAuthSubmit');

    formEl.addEventListener('submit', handleSubmit);
  }

  function showModal(message) {
    injectMarkup();
    modalEl.hidden = false;
    passwordEl.value = '';
    usernameEl.focus();
    if (message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    } else {
      errorEl.hidden = true;
    }
  }

  function hideModal() {
    if (modalEl) modalEl.hidden = true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    try {
      const res = await fetch(API_BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameEl.value.trim(), password: passwordEl.value })
      });
      if (!res.ok) {
        throw new Error(res.status === 401 ? 'Invalid username or password.' : 'Login failed (' + res.status + ').');
      }
      const data = await res.json();
      setToken(data.accessToken);
      passwordEl.value = '';
      hideModal();
      if (onAuthenticated) onAuthenticated();
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  }

  function logout() {
    clearToken();
    showModal();
  }

  // Shows the login modal (blocking interaction with the rest of the page) unless already
  // authenticated. Calls `callback` once a valid token exists, either immediately or right
  // after a successful login.
  function requireAuth(callback) {
    onAuthenticated = callback;
    injectMarkup();
    if (isAuthenticated()) {
      hideModal();
      callback();
    } else {
      showModal();
    }
  }

  return { requireAuth, apiFetch, getToken, logout, isAuthenticated };
})();
