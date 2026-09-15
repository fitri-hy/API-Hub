// API Playground Client-Side Logic
(() => {
  // === STATE ===
  let sessionToken = null;
  let sessionFingerprint = null;
  let sessionExpiry = null;
  let currentRoute = null;
  let requestHistory = [];
  let rateRemaining = 20;
  let sessionInterval = null;
  let countdownInterval = null;
  let routesData = [];

  // === INITIALIZATION ===
  document.addEventListener('DOMContentLoaded', async () => {
    await initPlayground();
    await loadApis();
    setupKeyboardShortcuts();
  });

  async function initPlayground() {
    // Always fetch session state from server — no localStorage
    // Server returns existing active session or creates a new one (1 per user)
    await createNewSession();
  }

  async function createNewSession() {
    try {
      const res = await fetch('/user/playground/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        sessionToken = data.session.token;
        sessionFingerprint = data.session.fingerprint;
        sessionExpiry = new Date(data.session.expiresAt);

        // Always get rate limit from server (DB state)
        if (data.rateLimit && typeof data.rateLimit.remaining === 'number') {
          rateRemaining = data.rateLimit.remaining;
        } else {
          // Fallback: fetch from DB via status endpoint
          await fetchRateLimitFromServer();
        }
        updateRateLimit();

        updateStatus('active');
        startSessionTimer();
        startCountdownTimer();
      } else {
        updateStatus('error');
      }
    } catch (err) {
      console.error('Init failed:', err);
      updateStatus('error');
    }
  }

  async function fetchRateLimitFromServer() {
    try {
      const res = await fetch('/user/playground/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': sessionToken || '',
          'fingerprint': sessionFingerprint || ''
        }
      });
      const data = await res.json();
      if (data.success && data.rateLimit && typeof data.rateLimit.remaining === 'number') {
        rateRemaining = data.rateLimit.remaining;
      }
    } catch (err) {
      console.error('Failed to fetch rate limit from server:', err);
    }
  }

  function startSessionTimer() {
    if (sessionInterval) clearInterval(sessionInterval);
    sessionInterval = setInterval(async () => {
      if (!sessionExpiry || Date.now() >= sessionExpiry.getTime()) {
        updateStatus('expired');
        // Session expired — server will create new one on next init
        await createNewSession();
      }
    }, 5000);
  }

  function startCountdownTimer() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      if (sessionExpiry) {
        const remaining = Math.max(0, Math.floor((sessionExpiry - Date.now()) / 1000));
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const el = document.getElementById('session-timer');
        if (el) {
          el.textContent =
            String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
        }
      }
    }, 1000);
  }

  function updateStatus(status) {
    const el = document.getElementById('session-status');
    if (!el) return;

    if (status === 'active') {
      el.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse"></span><span class="font-medium">Active</span>';
      el.className = 'inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-500/20';
    } else if (status === 'expired') {
      el.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500 mr-2"></span><span class="font-medium">Refreshing...</span>';
      el.className = 'inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200/70 dark:border-amber-500/20';
    } else {
      el.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500 mr-2"></span><span class="font-medium">Error</span>';
      el.className = 'inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400 border border-rose-200/70 dark:border-rose-500/20';
    }
  }

  // === LOAD APIS ===
  async function loadApis() {
    try {
      const res = await fetch('/user/playground/apis');
      const data = await res.json();
      const select = document.getElementById('api-select');
      if (!select) return;

      select.innerHTML = '<option value="">Select API...</option>';

      if (!data.apis || data.apis.length === 0) {
        select.innerHTML += '<option value="">No APIs available</option>';
        return;
      }

      data.apis.forEach(api => {
        const opt = document.createElement('option');
        opt.value = api.slug;
        opt.textContent = api.name + ' v' + api.version;
        opt.dataset.description = api.description || '';
        opt.dataset.baseRoute = api.baseRoute;
        select.appendChild(opt);
      });

      select.addEventListener('change', handleApiChange);
    } catch (err) {
      console.error('Failed to load APIs');
    }
  }

  function handleApiChange(e) {
    const slug = e.target.value;
    if (!slug) return;
    
    const pathInput = document.getElementById('path-input');
    if (pathInput && currentRoute) {
      const cleanPath = currentRoute.path.startsWith('/') ? currentRoute.path : '/' + currentRoute.path;
      pathInput.value = `/${slug}${cleanPath}`;
      pathInput.dataset.cleanPath = cleanPath;
    }
    
    loadRoutes(slug);
  }

  async function loadRoutes(slug) {
    const container = document.getElementById('routes-list');
    if (!container) return;

    container.innerHTML = '<p class="text-xs text-center py-4">Loading...</p>';

    try {
      const res = await fetch('/user/playground/apis/' + slug + '/routes');
      const data = await res.json();
      container.innerHTML = '';
      routesData = data.routes || [];

      if (routesData.length === 0) {
        container.innerHTML = '<p class="text-xs text-center py-4">No routes available</p>';
        return;
      }

      routesData.forEach((route, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'route-card w-full text-left p-3 rounded-lg border border-gray-200/70 dark:border-gray-800/70 group';
        btn.dataset.routeIndex = index;
        btn.onclick = function () { selectRoute(index, btn); };

        const methodColors = {
          GET: 'bg-emerald-50 text-emerald-600 border border-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
          POST: 'bg-blue-50 text-blue-600 border border-blue-200/70 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
          PUT: 'bg-amber-50 text-amber-600 border border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
          DELETE: 'bg-rose-50 text-rose-600 border border-rose-200/70 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20',
          PATCH: 'bg-purple-50 text-purple-600 border border-purple-200/70 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20'
        };

        const methodBadge = methodColors[route.method] || 'bg-gray-50';
        const desc = route.description || '';
        const descShort = desc.length > 40 ? desc.substring(0, 40) + '...' : desc;

        btn.innerHTML =
          '<div class="flex items-center gap-3">' +
            '<span class="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide ' + methodBadge + '">' + route.method + '</span>' +
            '<div class="min-w-0 flex-1">' +
              '<p class="font-mono text-sm font-medium truncate">' + escapeHtml(route.path) + '</p>' +
              (descShort ? '<p class="text-xs truncate">' + escapeHtml(descShort) + '</p>' : '') +
            '</div>' +
            '<svg class="h-4 w-4 group-hover:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>' +
            '</svg>' +
          '</div>';

        container.appendChild(btn);
      });

      const cfg = document.getElementById('request-config');
      if (cfg) cfg.style.display = 'block';
    } catch (err) {
      container.innerHTML = '<p class="text-xs text-center py-4">Failed to load routes</p>';
    }
  }

  function selectRoute(index, btnElement) {
    currentRoute = routesData[index];
    if (!currentRoute) return;

    const methodSel = document.getElementById('method-select');
    const pathInput = document.getElementById('path-input');
    const apiSel = document.getElementById('api-select');
    
    if (methodSel) methodSel.value = currentRoute.method;
    
    if (pathInput && apiSel) {
      const slug = apiSel.value || 'slug';
      const cleanPath = currentRoute.path.startsWith('/') ? currentRoute.path : '/' + currentRoute.path;
      
      pathInput.value = `/${slug}${cleanPath}`;
      pathInput.dataset.cleanPath = cleanPath;
    }

	const bodyInput = document.getElementById('body-input');

	if (bodyInput) {
	  bodyInput.value = '';
	}

    showDocs(currentRoute);

    document.querySelectorAll('.route-card').forEach(c => c.classList.remove('border-b-2', 'border-blue-500'));  
    if (btnElement) btnElement.classList.add('border-b-2', 'border-blue-500');
  }

  function showDocs(route) {
    const noSel = document.getElementById('no-route-selected');
    const panel = document.getElementById('docs-panel');
    const content = document.getElementById('docs-content');

    if (noSel) noSel.style.display = 'none';
    if (panel) panel.style.display = 'block';
    if (!content) return;

    let html = '';

    if (route.description) {
      html +=
        '<div class="mb-4 pb-4 border-b border-gray-200/70 dark:border-gray-800/70">' +
          '<h4 class="text-xs font-semibold uppercase tracking-wider mb-2">Description</h4>' +
          '<p class="text-sm border-l-4 border-blue-500 pl-3">' + escapeHtml(route.description) + '</p>' +
        '</div>';
    }

    if (route.documentationHtml) {
      html +=
        '<div class="mb-4 pb-4 border-b border-gray-200/70 dark:border-gray-800/70">' +
          '<h4 class="text-xs font-semibold uppercase tracking-wider mb-2">Documentation</h4>' +
          '<div class="prose prose-sm dark:prose-invert max-w-none">' + route.documentationHtml + '</div>' +
        '</div>';
    }

    if (route.requestSchema) {
      try {
        const schema = typeof route.requestSchema === 'string' ? JSON.parse(route.requestSchema) : route.requestSchema;
        html +=
          '<div class="mb-4 pb-4 border-b border-gray-200/70 dark:border-gray-800/70">' +
            '<h4 class="text-xs font-semibold uppercase tracking-wider mb-2">Request Schema</h4>' +
            '<pre class="bg-gray-900 p-3 rounded-lg text-xs overflow-x-auto font-mono">' + escapeHtml(JSON.stringify(schema, null, 2)) + '</pre>' +
          '</div>';
      } catch (e) {}
    }

    if (route.responseSchema) {
      try {
        const schema = typeof route.responseSchema === 'string' ? JSON.parse(route.responseSchema) : route.responseSchema;
        html +=
          '<div class="mb-4 pb-4 border-b border-gray-200/70 dark:border-gray-800/70">' +
            '<h4 class="text-xs font-semibold uppercase tracking-wider mb-2">Response Schema</h4>' +
            '<pre class="bg-gray-900 p-3 rounded-lg text-xs overflow-x-auto font-mono">' + escapeHtml(JSON.stringify(schema, null, 2)) + '</pre>' +
          '</div>';
      } catch (e) {}
    }

    if (route.sampleResponse) {
      try {
        const sample = typeof route.sampleResponse === 'string' ? JSON.parse(route.sampleResponse) : route.sampleResponse;
        html +=
          '<div>' +
            '<h4 class="text-xs font-semibold uppercase tracking-wider mb-2">Sample Response</h4>' +
            '<pre class="bg-gray-900 p-3 rounded-lg text-xs overflow-x-auto font-mono">' + escapeHtml(JSON.stringify(sample, null, 2)) + '</pre>' +
          '</div>';
      } catch (e) {}
    }

    if (!html) {
      html = '<p class="text-sm">No documentation available for this endpoint.</p>';
    }

    content.innerHTML = html;
  }

  // === TABS ===
  function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('tab-active', 'border-blue-500', 'text-blue-600', 'dark:text-blue-400');
      b.classList.add('border-transparent');
    });

    const tab = document.getElementById(tabName + '-tab');
    if (tab) tab.classList.remove('hidden');

    const activeBtn = document.querySelector('[data-tab="' + tabName + '"]');
    if (activeBtn) {
      activeBtn.classList.remove('border-transparent');
      activeBtn.classList.add('tab-active', 'border-blue-500', 'text-blue-600', 'dark:text-blue-400');
    }
  }

  // === PARAMS & HEADERS ===
  function addParam() {
    const container = document.getElementById('params-tab');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'flex gap-2 items-center params-row';
    row.innerHTML =
      '<input type="text" placeholder="Key" class="w-full flex-1 px-2 py-1.5 text-xs bg-form param-key">' +
      '<input type="text" placeholder="Value" class="w-full flex-1 px-2 py-1.5 text-xs bg-form param-value">' +
      '<button type="button" onclick="window.playgroundApp.removeParam(this)" class="flex p-1 items-center justify-center btn-failed rounded-full">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"></path>' +
      '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m18 18l-6-6m0 0L6 6m6 6l6-6m-6 6l-6 6"></path></svg></button>';
    
    const addBtn = container.querySelector('button[onclick*="addParam"]');
    if (addBtn) container.insertBefore(row, addBtn);
    else container.appendChild(row);
  }

  function removeParam(btn) {
    const row = btn.closest('.params-row');
    if (!row) return;
    const all = document.querySelectorAll('.params-row');
    if (all.length > 1) {
      row.remove();
    } else {
      const k = row.querySelector('.param-key');
      const v = row.querySelector('.param-value');
      if (k) k.value = '';
      if (v) v.value = '';
    }
  }

  // === HEADERS ==
  function addHeader() {
    const container = document.getElementById('headers-tab');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'flex gap-2 items-center header-row';
    row.innerHTML =
      '<input type="text" placeholder="Key" class="w-full flex-1 px-2 py-1.5 text-xs bg-form header-key">' +
      '<input type="text" placeholder="Value" class="w-full flex-1 px-2 py-1.5 text-xs bg-form header-value">' +
      '<button type="button" onclick="this.closest(\'.header-row\').remove()" class="flex p-1 items-center justify-center btn-failed rounded-full">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"></path>' +
      '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m18 18l-6-6m0 0L6 6m6 6l6-6m-6 6l-6 6"></path></svg></button>';
    
    const addBtn = container.querySelector('button[onclick*="addHeader"]');
    if (addBtn) container.insertBefore(row, addBtn);
    else container.appendChild(row);
  }

  // === AUTH TYPE ===
  function authTypeChanged() {
    const type = document.getElementById('auth-type');
    if (!type) return;
    const val = type.value;
    ['apikey', 'bearer', 'basic'].forEach(t => {
      const el = document.getElementById('auth-' + t);
      if (el) el.classList.toggle('hidden', t !== val);
    });
  }

  // === BODY TYPE ===
  function bodyTypeChanged() {
    const type = document.getElementById('body-type');
    if (!type) return;
    const val = type.value;
    const jsonBlock = document.getElementById('body-json');
    const fdBlock = document.getElementById('body-formdata');
    if (jsonBlock) jsonBlock.classList.toggle('hidden', val !== 'json');
    if (fdBlock) fdBlock.classList.toggle('hidden', val !== 'formdata');
  }

  // === FORM DATA FIELDS ===
  function addFormDataField(type) {
    const container = document.getElementById('formdata-fields');
    if (!container) return;
    const isFile = type === 'file';
    const row = document.createElement('div');
    row.className = 'flex gap-2 items-center formdata-row';
    row.dataset.type = isFile ? 'file' : 'text';

    if (isFile) {
      row.innerHTML =
        '<select class="bg-form px-2 py-1.5 text-xs formdata-type" onchange="window.playgroundApp.formDataTypeChanged(this)">' +
        '<option value="text">Text</option>' +
        '<option value="file" selected>File</option>' +
        '</select>' +
        '<input type="text" placeholder="Key (field name)" class="w-full flex-1 px-2 py-1.5 text-xs bg-form formdata-key">' +
        '<input type="file" class="w-full flex-1 px-2 py-1.5 text-xs bg-form formdata-file">' +
        '<button type="button" onclick="window.playgroundApp.removeFormDataField(this)" class="flex p-1 items-center justify-center btn-failed rounded-full">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"></path>' +
        '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m18 18l-6-6m0 0L6 6m6 6l6-6m-6 6l-6 6"></path></svg></button>';
    } else {
      row.innerHTML =
        '<select class="bg-form px-2 py-1.5 text-xs formdata-type" onchange="window.playgroundApp.formDataTypeChanged(this)">' +
        '<option value="text" selected>Text</option>' +
        '<option value="file">File</option>' +
        '</select>' +
        '<input type="text" placeholder="Key" class="w-full flex-1 px-2 py-1.5 text-xs bg-form formdata-key">' +
        '<input type="text" placeholder="Value" class="w-full flex-1 px-2 py-1.5 text-xs bg-form formdata-value">' +
        '<button type="button" onclick="window.playgroundApp.removeFormDataField(this)" class="flex p-1 items-center justify-center btn-failed rounded-full">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"></path>' +
        '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m18 18l-6-6m0 0L6 6m6 6l6-6m-6 6l-6 6"></path></svg></button>';
    }
    container.appendChild(row);
  }

  function formDataTypeChanged(selectEl) {
    const row = selectEl.closest('.formdata-row');
    if (!row) return;
    const newType = selectEl.value;
    const oldType = row.dataset.type;
    if (newType === oldType) return;
    row.dataset.type = newType;

    if (newType === 'file') {
      // Replace value input with file input
      const valInput = row.querySelector('.formdata-value');
      if (valInput) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.className = 'w-full flex-1 px-2 py-1.5 text-xs bg-form formdata-file';
        valInput.replaceWith(fileInput);
      }
    } else {
      // Replace file input with text input
      const fileInput = row.querySelector('.formdata-file');
      if (fileInput) {
        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.placeholder = 'Value';
        valInput.className = 'w-full flex-1 px-2 py-1.5 text-xs bg-form formdata-value';
        fileInput.replaceWith(valInput);
      }
    }
  }

  function removeFormDataField(btn) {
    const row = btn.closest('.formdata-row');
    if (!row) return;
    const all = document.querySelectorAll('.formdata-row');
    if (all.length > 1) {
      row.remove();
    } else {
      const k = row.querySelector('.formdata-key');
      const v = row.querySelector('.formdata-value');
      if (k) k.value = '';
      if (v) v.value = '';
    }
  }

  // === SEND REQUEST ===
  async function sendRequest() {
    if (!sessionToken) {
      alert('Session not initialized. Please refresh.');
      return;
    }

    const btn = document.getElementById('send-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Sending...';
    }

    const queryParams = {};
    document.querySelectorAll('.params-row').forEach(row => {
      const keyEl = row.querySelector('.param-key');
      const valEl = row.querySelector('.param-value');
      if (keyEl && valEl) {
        const k = keyEl.value.trim();
        const v = valEl.value.trim();
        if (k) queryParams[k] = v;
      }
    });

    const headers = {};
    document.querySelectorAll('.header-row').forEach(row => {
      const keyEl = row.querySelector('.header-key');
      const valEl = row.querySelector('.header-value');
      if (keyEl && valEl) {
        const k = keyEl.value.trim();
        const v = valEl.value.trim();
        if (k) headers[k] = v;
      }
    });

    // --- Auth data ---
    const authTypeEl = document.getElementById('auth-type');
    const authType = authTypeEl ? authTypeEl.value : 'none';
    if (authType === 'apikey') {
      const nameEl = document.getElementById('auth-apikey-name');
      const locEl = document.getElementById('auth-apikey-location');
      const valEl = document.getElementById('auth-apikey-value');
      const name = nameEl ? nameEl.value.trim() : '';
      const val = valEl ? valEl.value.trim() : '';
      if (name && val) {
        if (locEl && locEl.value === 'query') {
          queryParams[name] = val;
        } else {
          headers[name] = val;
        }
      }
    } else if (authType === 'bearer') {
      const tokenEl = document.getElementById('auth-bearer-token');
      const token = tokenEl ? tokenEl.value.trim() : '';
      if (token) headers['Authorization'] = 'Bearer ' + token;
    } else if (authType === 'basic') {
      const userEl = document.getElementById('auth-basic-username');
      const passEl = document.getElementById('auth-basic-password');
      const u = userEl ? userEl.value.trim() : '';
      const p = passEl ? passEl.value : '';
      if (u) headers['Authorization'] = 'Basic ' + btoa(u + ':' + p);
    }

    // --- Body data ---
    const bodyTypeEl = document.getElementById('body-type');
    const bodyType = bodyTypeEl ? bodyTypeEl.value : 'json';
    let body = null;
    let hasFiles = false;
    if (bodyType === 'formdata') {
      const fdRows = document.querySelectorAll('.formdata-row');
      const fdData = {};
      fdRows.forEach(row => {
        const k = row.querySelector('.formdata-key');
        if (!k) return;
        const key = k.value.trim();
        if (!key) return;
        const fileInput = row.querySelector('.formdata-file');
        if (fileInput && fileInput.files.length > 0) {
          fdData[key] = fileInput.files[0];
          hasFiles = true;
        } else {
          const v = row.querySelector('.formdata-value');
          if (v) fdData[key] = v.value;
        }
      });
      if (Object.keys(fdData).length > 0) body = fdData;
      // Don't set Content-Type manually for multipart - browser sets it with boundary
      if (!hasFiles) headers['Content-Type'] = 'multipart/form-data';
    } else {
      const bodyEl = document.getElementById('body-input');
      if (bodyEl) {
        const bodyStr = bodyEl.value.trim();
        if (bodyStr) {
          try { body = JSON.parse(bodyStr); } catch (e) { body = bodyStr; }
        }
      }
      if (body && typeof body === 'object' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const apiSel = document.getElementById('api-select');
    const methodSel = document.getElementById('method-select');
    const pathInp = document.getElementById('path-input');

    let requestPath = '';
    if (pathInp) {
      if (pathInp.dataset.cleanPath) {
        requestPath = pathInp.dataset.cleanPath;
      } else {
        const parts = pathInp.value.split('/').filter(Boolean);
        requestPath = parts.length > 1 ? '/' + parts.slice(1).join('/') : pathInp.value;
      }
    }

    // Store payload for potential captcha retry
    const requestPayload = {
      apiSlug: apiSel ? apiSel.value : '',
      method: methodSel ? methodSel.value : 'GET',
      path: requestPath,
      headers: headers,
      body: body,
      queryParams: queryParams,
      captchaToken: null
    };
    lastRequestPayload = requestPayload;

    let res;
    try {
      let fetchOptions = {
        method: 'POST',
        headers: {
          'token': sessionToken,
          'fingerprint': sessionFingerprint
        }
      };

      if (hasFiles && bodyType === 'formdata') {
        // Use FormData for file uploads
        const formData = new FormData();
        // Always include required fields
        formData.append('apiSlug', requestPayload.apiSlug || '');
        formData.append('method', requestPayload.method || 'GET');
        formData.append('path', requestPayload.path || '');
        // Add auth headers as JSON string so server can parse them
        if (requestPayload.headers && Object.keys(requestPayload.headers).length > 0) {
          formData.append('headers', JSON.stringify(requestPayload.headers));
        }
        // Add query params as JSON string
        if (requestPayload.queryParams && Object.keys(requestPayload.queryParams).length > 0) {
          formData.append('queryParams', JSON.stringify(requestPayload.queryParams));
        }
        // Add body fields (text + files)
        if (body && typeof body === 'object') {
          for (const [key, value] of Object.entries(body)) {
            if (value instanceof File) {
              // Send file with field name 'file' to match gateway format
              formData.append('file', value, value.name);
            } else {
              formData.append(key, value);
            }
          }
        }
        fetchOptions.body = formData;
        // Don't set Content-Type header - browser sets it with boundary
      } else {
        fetchOptions.headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(requestPayload);
      }

      res = await fetch('/user/playground/execute', fetchOptions);

      const data = await res.json();
      const statusEl = document.getElementById('response-status');
      const labelEl = document.getElementById('status-label');
      const timeEl = document.getElementById('response-time');
      const jsonEl = document.getElementById('response-json');

      if (statusEl) {
        statusEl.textContent = res.status;
        statusEl.className = 'font-mono font-bold text-lg ' + (res.ok ? 'text-emerald-500' : 'text-rose-500');
      }
      if (labelEl) labelEl.textContent = res.statusText || (res.ok ? 'Success' : 'Error');
      if (timeEl) timeEl.textContent = (data.meta && data.meta.responseTime) || '—';
      if (jsonEl) jsonEl.textContent = JSON.stringify(data, null, 2);

      const remainingHeader = res.headers.get('X-RateLimit-Remaining');
      // Only update rate limit on successful responses (server only increments on success)
      if (res.ok && remainingHeader) {
        rateRemaining = parseInt(remainingHeader);
        updateRateLimit();
      }

      if (data.code === 'CAPTCHA_REQUIRED' && data.captcha) {
        showCaptchaModal(data.captcha);
      }

      // Enable copy/clear buttons after response
      const copyBtn = document.getElementById('copy-btn');
      const clearBtn = document.getElementById('clear-btn');
      if (copyBtn) copyBtn.disabled = false;
      if (clearBtn) clearBtn.disabled = false;

      if (methodSel && pathInp) {
        addToHistory(methodSel.value, pathInp.value, res.status, data);
      }
    } catch (err) {
      const statusEl = document.getElementById('response-status');
      const jsonEl = document.getElementById('response-json');
      if (statusEl) {
        statusEl.textContent = 'ERROR';
        statusEl.className = 'font-mono font-bold text-lg text-rose-500';
      }
      if (jsonEl) jsonEl.textContent = JSON.stringify({ error: err.message }, null, 2);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Send Request';
      }
    }

    // Handle session expired from server
    if (res && (res.status === 401 || res.status === 403)) {
      updateStatus('expired');
      await createNewSession();
    }
  }

  function updateRateLimit() {
    const pct = (rateRemaining / 20) * 100;
    const bar = document.getElementById('rate-progress');
    const txt = document.getElementById('rate-text');
    if (bar) {
      bar.style.width = pct + '%';
      if (rateRemaining <= 5) {
        bar.className = 'h-full bg-gradient-to-r from-rose-500 to-orange-500 transition-all duration-500';
      } else {
        bar.className = 'h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500';
      }
    }
    if (txt) txt.textContent = rateRemaining + '/20';
  }

  function copyResponse() {
    const jsonEl = document.getElementById('response-json');
    const btn = document.getElementById('copy-btn');
    if (!jsonEl || !btn) return;
    const text = jsonEl.textContent || '';
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  }

  function clearResponse() {
    const statusEl = document.getElementById('response-status');
    const timeEl = document.getElementById('response-time');
    const labelEl = document.getElementById('status-label');
    const jsonEl = document.getElementById('response-json');
    if (jsonEl) jsonEl.innerHTML = '<span>No response yet. Configure your request and click Send.</span>';
    if (statusEl) {
      statusEl.textContent = '\u2014';
      statusEl.className = 'font-mono font-bold text-lg';
    }
    if (timeEl) timeEl.textContent = '\u2014';
    if (labelEl) labelEl.textContent = 'Waiting';
  }

  // === CAPTCHA ===
  let pendingCaptchaData = null;

  function showCaptchaModal(captchaData) {
    pendingCaptchaData = captchaData;
    const existing = document.getElementById('captcha-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'captcha-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60';
  
    modal.innerHTML = `
    <div class="bg-white dark:bg-slate-900 p-6 rounded-xl w-full max-w-sm mx-4 space-y-4 shadow-xl border border-gray-200/70 dark:border-gray-800/70">
        <div class="text-center">
            <div class="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 mb-3">
                <svg class="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                </svg>
            </div>
            <h3 class="text-base font-bold mb-1">Verification Required</h3>
            <p class="text-xs">Solve this simple math problem to continue:</p>
        </div>

		<div class="text-center px-2">
            <div class="text-3xl font-bold font-mono py-4 bg-gray-50 dark:bg-slate-950/50 rounded-xl border border-gray-200/70 dark:border-gray-800/70 tracking-widest">
                ${escapeHtml(captchaData.question)}
            </div>
        </div>

        <div class="flex gap-2">
            <input type="number" id="captcha-answer" class="w-full flex-1 bg-form px-4 py-2.5 text-center text-lg font-mono rounded-md" placeholder="?" autofocus>
            <button type="button" onclick="window.playgroundApp.submitCaptcha()" class="py-2.5 px-5 btn-normal rounded-md font-semibold text-xs flex items-center justify-center">Verify</button>
        </div>

        <p id="captcha-error" class="text-xs text-rose-500 text-center font-medium hidden">Incorrect answer, try again.</p>
        
        <div class="pt-1 border-t border-gray-200/70 dark:border-gray-800/70">
            <button type="button" onclick="document.getElementById('captcha-modal').remove()" class="text-xs text-center w-full pt-4-1 link-rose font-medium">Cancel</button>
        </div>
    </div>
    `;

    document.body.appendChild(modal);

    const input = document.getElementById('captcha-answer');
    if (input) {
      input.focus();
      input.addEventListener('keydown', (e) => { 
        if (e.key === 'Enter') {
          if (window.playgroundApp && typeof window.playgroundApp.submitCaptcha === 'function') {
            window.playgroundApp.submitCaptcha();
          }
        } 
      });
    }
  }

  async function submitCaptcha() {
    if (!pendingCaptchaData) return;
    const input = document.getElementById('captcha-answer');
    const errEl = document.getElementById('captcha-error');
    if (!input) return;
    const answer = parseInt(input.value, 10);
    if (isNaN(answer)) {
      if (errEl) { errEl.textContent = 'Please enter a number.'; errEl.classList.remove('hidden'); }
      return;
    }

    const btn = document.querySelector('#captcha-modal button[onclick*="submitCaptcha"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }

    try {
      const lastReq = lastRequestPayload;
      if (!lastReq) return;

      const res = await fetch('/user/playground/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': sessionToken,
          'fingerprint': sessionFingerprint
        },
        body: JSON.stringify({
          ...lastReq,
          captchaToken: pendingCaptchaData.captchaToken,
          captchaAnswer: answer
        })
      });

      const data = await res.json();
      if (res.ok || data.code !== 'CAPTCHA_REQUIRED') {
        const modal = document.getElementById('captcha-modal');
        if (modal) modal.remove();
        pendingCaptchaData = null;

        const statusEl = document.getElementById('response-status');
        const labelEl = document.getElementById('status-label');
        const timeEl = document.getElementById('response-time');
        const jsonEl = document.getElementById('response-json');
        if (statusEl) {
          statusEl.textContent = res.status;
          statusEl.className = 'font-mono font-bold text-lg ' + (res.ok ? 'text-emerald-500' : 'text-rose-500');
        }
        if (labelEl) labelEl.textContent = res.statusText || (res.ok ? 'Success' : 'Error');
        if (timeEl) timeEl.textContent = (data.meta && data.meta.responseTime) || '\u2014';
        if (jsonEl) jsonEl.textContent = JSON.stringify(data, null, 2);
        const remainingHeader = res.headers.get('X-RateLimit-Remaining');
        if (res.ok && remainingHeader) { rateRemaining = parseInt(remainingHeader); updateRateLimit(); }
        const copyBtn = document.getElementById('copy-btn');
        const clearBtn = document.getElementById('clear-btn');
        if (copyBtn) copyBtn.disabled = false;
        if (clearBtn) clearBtn.disabled = false;
      } else {
        if (errEl) { errEl.textContent = 'Incorrect answer. Try again.'; errEl.classList.remove('hidden'); }
        if (input) { input.value = ''; input.focus(); }
        if (data.captcha) pendingCaptchaData = data.captcha;
      }
    } catch (err) {
      if (errEl) { errEl.textContent = 'Network error, try again.'; errEl.classList.remove('hidden'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Verify'; }
    }
  }

  let lastRequestPayload = null;

  // === HISTORY ===
  function addToHistory(method, path, status, responseData) {
    const historyItem = {
      method: method,
      path: path,
      status: status,
      time: new Date().toLocaleTimeString(),
      data: responseData
    };
    requestHistory.unshift(historyItem);
    if (requestHistory.length > 12) requestHistory.pop();

    const container = document.getElementById('request-history');
    if (!container) return;
    if (requestHistory.length === 1) container.innerHTML = '';

    const item = document.createElement('div');
    const color = status < 400 ? 'emerald' : 'rose';
    item.className = 'p-3 rounded-lg border border-gray-200/70 dark:border-gray-800/70 hover:bg-' + color + '-50 dark:hover:bg-' + color + '-950/20 cursor-pointer transition-colors';
    item.onclick = function () { replayRequest(historyItem); };

    item.innerHTML =
      '<div class="flex items-center gap-2 mb-1">' +
        '<span class="font-mono font-bold text-' + color + '-500">' + status + '</span>' +
        '<span class="font-mono text-' + color + '-500 font-bold text-xs px-1.5 py-0.5 rounded bg-' + color + '-50 dark:bg-' + color + '-500/10">' + escapeHtml(method) + '</span>' +
        '<span class="font-mono text-xs truncate flex-1" title="' + escapeHtml(path) + '">' + escapeHtml(path) + '</span>' +
      '</div>' +
      '<div class="flex items-center justify-between text-[10px]">' +
        '<span>' + historyItem.time + '</span>' +
        '<span class="link">Click to replay</span>' +
      '</div>';

    container.insertBefore(item, container.firstChild);
  }

  function replayRequest(historyItem) {
    const methodSel = document.getElementById('method-select');
    const pathInp = document.getElementById('path-input');
    const jsonEl = document.getElementById('response-json');
    if (methodSel) methodSel.value = historyItem.method;
    if (pathInp) pathInp.value = historyItem.path;
    if (jsonEl && historyItem.data) {
      jsonEl.textContent = JSON.stringify(historyItem.data, null, 2);
    }
  }

  // === KEYBOARD SHORTCUTS ===
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        sendRequest();
      }
    });
  }

  // === HELPERS ===
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Expose public API for inline onclick handlers
  window.playgroundApp = {
    showTab: showTab,
    addParam: addParam,
    addHeader: addHeader,
    removeParam: removeParam,
    sendRequest: sendRequest,
    copyResponse: copyResponse,
    clearResponse: clearResponse,
    selectRoute: selectRoute,
    submitCaptcha: submitCaptcha,
    authTypeChanged: authTypeChanged,
    bodyTypeChanged: bodyTypeChanged,
    addFormDataField: addFormDataField,
    removeFormDataField: removeFormDataField,
    formDataTypeChanged: formDataTypeChanged
  };
})();
