/**
 * notifications.js — Real-time notifications via Socket.IO + polling fallback
 */
(function () {
  'use strict';

  var state = {
    socket: null,
    isOpen: false,
    unreadCount: 0,
    notifications: [],
    initialized: false,
    basePath: '/admin'
  };

  function els() {
    return {
      bell: document.getElementById('notification-bell'),
      badge: document.getElementById('notification-badge'),
      dropdown: document.getElementById('notification-dropdown'),
      list: document.getElementById('notification-list'),
      empty: document.getElementById('notification-empty'),
      markAll: document.getElementById('notif-mark-all')
    };
  }

  // ============================================================
  // Helpers
  // ============================================================
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    var now = Date.now();
    var date = new Date(dateStr);
    var diff = Math.floor((now - date.getTime()) / 1000);
    if (diff < 0) return 'Just now';
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return date.toLocaleDateString();
  }

  var iconMap = {
    'user-plus': '<path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/>',
    'check-circle': '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    'x-circle': '<path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    'credit-card': '<path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>',
    'plus-circle': '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m6-6H6"/>',
    'minus-circle': '<path stroke-linecap="round" stroke-linejoin="round" d="M18 12H6"/>',
    'shield-check': '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138z"/>',
    'shield-x': '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>',
    'badge-check': '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>',
    'alert-triangle': '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>',
    'megaphone': '<path stroke-linecap="round" stroke-linejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/>',
    'upload': '<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>',
    'user-check': '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>',
    'key': '<path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>',
    'package': '<path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>',
    'bell': '<path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>',
    'trending-down': '<path stroke-linecap="round" stroke-linejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"/>',
    'clock': '<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    'login': '<path stroke-linecap="round" stroke-linejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/>',
    'server': '<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"/>'
  };

  var typeToIconMap = {
    'new_user': 'user-plus',
    'transaction_approved': 'check-circle',
    'transaction_rejected': 'x-circle',
    'transaction_pending': 'credit-card',
    'credit_add': 'plus-circle',
    'credit_deduct': 'minus-circle',
    'verification_approved': 'shield-check',
    'verification_rejected': 'shield-x',
    'verification_pending': 'badge-check',
    'system_alert': 'alert-triangle',
    'admin_push': 'megaphone',
    'payment_proof_uploaded': 'upload',
    'profile_updated': 'user-check',
    'api_key_limit_warning': 'key',
    'package_changed': 'package',
    'low_credit_warning': 'trending-down',
    'credit_exhausted': 'alert-triangle',
    'package_expiring': 'clock',
    'package_expired': 'x-circle',
    'new_login': 'login',
    'system_maintenance': 'server'
  };

  function typeToIcon(notif) {
    var icon = notif.icon || typeToIconMap[notif.type] || 'bell';
    return iconMap[icon] || iconMap['bell'];
  }

  function typeToColor(notif) {
    var t = notif.type;
    if (['transaction_approved', 'credit_add', 'verification_approved', 'new_user', 'profile_updated'].includes(t))
      return 'text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30';
    if (['transaction_rejected', 'credit_deduct', 'verification_rejected', 'system_alert', 'credit_exhausted', 'package_expired'].includes(t))
      return 'text-rose-500 bg-rose-100 dark:bg-rose-900/30';
    if (['transaction_pending', 'verification_pending', 'api_key_limit_warning', 'low_credit_warning', 'package_expiring'].includes(t))
      return 'text-amber-500 bg-amber-100 dark:bg-amber-900/30';
    if (t === 'admin_push')
      return 'text-purple-500 bg-purple-100 dark:bg-purple-900/30';
    if (t === 'new_login')
      return 'text-cyan-500 bg-cyan-100 dark:bg-cyan-900/30';
    if (t === 'system_maintenance')
      return 'text-blue-500 bg-blue-100 dark:bg-blue-900/30';
    return 'text-gray-500 bg-gray-100 dark:bg-gray-800';
  }

  function buildNotifHTML(notif) {
    var colorClass = typeToColor(notif);
    var iconSvg = typeToIcon(notif);
    var title = escapeHtml(notif.title);
    var message = escapeHtml(notif.message);
    var timeAgo = formatTimeAgo(notif.created_at);
    var link = notif.type === 'admin_push' ? (notif.link || '') : '';
    var id = notif.id;
    var imageUrl = notif.image_url || '';
    var isPush = notif.type === 'admin_push';
    var readClass = notif.is_read ? '' : 'bg-blue-50/30 dark:bg-blue-950/10';
    var dot = notif.is_read ? '' : '<span class="inline-block ml-1.5 h-1.5 w-1.5 rounded-full bg-blue-500"></span>';
    var cursorClass = isPush ? 'cursor-pointer' : '';

    var imageHtml = '';
    if (imageUrl) {
      imageHtml = '<div class="mt-2 rounded-lg overflow-hidden border border-gray-100 dark:border-gray-800"><img src="' + escapeHtml(imageUrl) + '" alt="" class="w-full h-32 object-cover" onerror="this.parentElement.remove()"></div>';
    }

    return '<div class="notif-item flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ' + cursorClass + ' border-b border-gray-50 dark:border-gray-800/50 ' + readClass + '" data-id="' + id + '" data-type="' + escapeHtml(notif.type) + '" data-link="' + escapeHtml(link) + '">' +
      '<div class="shrink-0 mt-0.5">' +
        '<div class="flex h-8 w-8 items-center justify-center rounded-full ' + colorClass + '">' +
          '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' + iconSvg + '</svg>' +
        '</div>' +
      '</div>' +
      '<div class="flex-1 min-w-0">' +
        '<h6 class="text-sm font-semibold">' + title + dot + '</h6>' +
        '<p class="text-xs mt-0.5 line-clamp-2">' + message + '</p>' +
        imageHtml +
        '<div class="flex items-center gap-2 mt-1">' +
          '<span class="text-[10px]">' + timeAgo + '</span>' +
          (link ? '<a href="' + escapeHtml(link) + '" class="text-[10px] font-medium link">View</a>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // Badge
  // ============================================================
  function updateBadge(count) {
    var e = els();
    if (!e.badge) return;
    state.unreadCount = count || 0;
    if (state.unreadCount > 0) {
      e.badge.textContent = state.unreadCount > 99 ? '99+' : state.unreadCount;
      e.badge.classList.remove('hidden');
    } else {
      e.badge.classList.add('hidden');
    }
    if (e.bell) e.bell.setAttribute('data-unread-count', state.unreadCount);
  }

  // ============================================================
  // Fetch unread count from server
  // ============================================================
  function fetchUnreadCount() {
    fetch('/notifications/unread-count')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          updateBadge(data.count);
        }
      })
      .catch(function() {});
  }

  // ============================================================
  // Dropdown
  // ============================================================
  function toggleDropdown(forceState) {
    var e = els();
    if (!e.dropdown) return;
    var shouldOpen = typeof forceState === 'boolean' ? forceState : e.dropdown.classList.contains('hidden');
    if (shouldOpen) {
      e.dropdown.classList.remove('hidden');
      state.isOpen = true;
      loadDropdownNotifications();
    } else {
      e.dropdown.classList.add('hidden');
      state.isOpen = false;
    }
  }

  function loadDropdownNotifications() {
    var e = els();
    if (!e.list || !e.empty) return;

    // Show loading state
    e.empty.classList.add('hidden');
    var existingItems = e.list.querySelectorAll('.notif-item');
    existingItems.forEach(function(item) { item.remove(); });

    var loadingEl = document.getElementById('notif-loading');
    if (!loadingEl) {
      loadingEl = document.createElement('div');
      loadingEl.id = 'notif-loading';
      loadingEl.className = 'px-4 py-6 text-center';
      loadingEl.innerHTML = '<svg class="animate-spin h-5 w-5 mx-auto" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><p class="text-xs text-gray-400 mt-2">Loading...</p>';
    }
    e.list.appendChild(loadingEl);

    fetch('/notifications/poll?since=0')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        // Remove loading
        var ld = document.getElementById('notif-loading');
        if (ld) ld.remove();

        if (!data.success || !data.data) return;
        state.notifications = data.data.notifications || [];

        if (state.notifications.length === 0) {
          e.empty.classList.remove('hidden');
          e.empty.style.display = '';
        } else {
          e.empty.classList.add('hidden');
          e.empty.style.display = 'none';
          var html = '';
          state.notifications.forEach(function(n) {
            html += buildNotifHTML(n);
          });
          e.list.insertAdjacentHTML('afterbegin', html);
          bindNotifItemClicks();
        }
      })
      .catch(function(err) {
        var ld = document.getElementById('notif-loading');
        if (ld) ld.remove();
        e.empty.classList.remove('hidden');
        console.error('Failed to load notifications:', err);
      });
  }

  function bindNotifItemClicks() {
    document.querySelectorAll('.notif-item').forEach(function(item) {
      item.addEventListener('click', function(e) {
        if (e.target.closest('a')) return;
        var id = this.dataset.id;
        var type = this.dataset.type;
        var link = this.dataset.link;
        var unread = this.classList.contains('bg-blue-50/30');
        if (unread && state.socket) {
          state.socket.emit('notification:mark-read', { id: parseInt(id) });
          this.classList.remove('bg-blue-50/30', 'dark:bg-blue-950/10');
          var dot = this.querySelector('.rounded-full.bg-blue-500');
          if (dot && dot.classList.contains('h-1.5')) dot.remove();
          updateBadge(Math.max(0, state.unreadCount - 1));
        }
        // Only navigate for admin_push notifications
        if (type === 'admin_push' && link) window.location.href = link;
      });
    });
  }

  // ============================================================
  // Socket.IO
  // ============================================================
  function connectSocket() {
    if (typeof io === 'undefined') {
      console.warn('Socket.IO not loaded');
      return;
    }

    state.socket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000 });

    state.socket.on('connect', function() {
      console.log('  Socket.IO connected');
      // Fetch latest count on connect/reconnect
      fetchUnreadCount();
    });

    state.socket.on('disconnect', function() {
      console.log('  Socket.IO disconnected');
    });

    state.socket.on('reconnect', function() {
      console.log('  Socket.IO reconnected');
      fetchUnreadCount();
    });

    // New notification received
    state.socket.on('notification:new', function(data) {
      var notification = data.notification;
      var unreadCount = data.unreadCount;

      if (typeof unreadCount === 'number') {
        updateBadge(unreadCount);
      } else {
        updateBadge(state.unreadCount + 1);
      }

      // Add to top of dropdown if open
      if (state.isOpen && notification) {
        state.notifications.unshift(notification);
        var list = document.getElementById('notification-list');
        var empty = document.getElementById('notification-empty');
        if (list && empty) {
          empty.classList.add('hidden');
          empty.style.display = 'none';
          list.insertAdjacentHTML('afterbegin', buildNotifHTML(notification));
          bindNotifItemClicks();
        }
      }

      showBrowserNotification(notification);
      try { navigator.vibrate && navigator.vibrate(200); } catch (e) {}
    });

    state.socket.on('notification:unread-count', function(data) {
      updateBadge(data.count);
    });

    state.socket.on('notification:error', function(data) {
      console.error('Notification error:', data.message);
    });
  }

  // ============================================================
  // Browser Notifications
  // ============================================================
  function showBrowserNotification(notif) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    var options = {
      body: notif.message || '',
      icon: notif.image_url || '/favicon.ico',
      tag: 'notif-' + (notif.id || Date.now()),
      renotify: true
    };

    try {
      var browserNotif = new Notification(notif.title || 'Notification', options);
      browserNotif.onclick = function() {
        window.focus();
        if (notif.link) window.location.href = notif.link;
        browserNotif.close();
      };
      setTimeout(function() { browserNotif.close(); }, 5000);
    } catch (e) {}
  }

  function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // ============================================================
  // Polling removed — Socket.IO handles real-time updates
  // ============================================================

  // ============================================================
  // Event Binding
  // ============================================================
  function bindEvents() {
    var e = els();
    if (!e.bell || !e.dropdown) return;

    e.bell.addEventListener('click', function(ev) {
      ev.stopPropagation();
      toggleDropdown();
    });

    if (e.markAll) {
      e.markAll.addEventListener('click', function(ev) {
        ev.stopPropagation();
        if (state.socket) {
          state.socket.emit('notification:mark-all-read');
        } else {
          fetch('/notifications/mark-all-read', { method: 'POST' }).then(function() {
            updateBadge(0);
            loadDropdownNotifications();
          });
        }
      });
    }

    document.addEventListener('click', function(ev) {
      if (state.isOpen) {
        var wrapper = document.getElementById('notification-wrapper');
        if (wrapper && !wrapper.contains(ev.target)) {
          toggleDropdown(false);
        }
      }
    });

    document.addEventListener('keydown', function(ev) {
      if (ev.key === 'Escape' && state.isOpen) {
        toggleDropdown(false);
      }
    });
  }

  // ============================================================
  // Initialize
  // ============================================================
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    if (window.location.pathname.startsWith('/user/')) {
      state.basePath = '/user';
    }

    var e = els();
    if (e.bell) {
      var initialCount = parseInt(e.bell.getAttribute('data-unread-count')) || 0;
      updateBadge(initialCount);
    }

    bindEvents();
    connectSocket();
    requestNotificationPermission();

    setTimeout(fetchUnreadCount, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
      fetchUnreadCount();
    }
  });

})();
