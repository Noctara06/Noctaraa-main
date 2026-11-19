(() => {
  const api = window.MidnightAPI;
  const page = document.body.dataset.page;

  if (!api || page !== "admin") {
    return;
  }

  const state = {
    session: null,
    currentUser: null,
    users: [],
    stories: [],
    reports: [],
    deletionRequests: []
  };
  let statusTimer = null;

  const elements = {
    adminUserLine: document.getElementById("adminUserLine"),
    goHomeBtn: document.getElementById("goHomeBtn"),
    adminLogoutBtn: document.getElementById("adminLogoutBtn"),
    statTotalUsers: document.getElementById("statTotalUsers"),
    statTotalStories: document.getElementById("statTotalStories"),
    statTotalReports: document.getElementById("statTotalReports"),
    statTotalViews: document.getElementById("statTotalViews"),
    statActiveUsers: document.getElementById("statActiveUsers"),
    usersTableBody: document.getElementById("usersTableBody"),
    storiesTableBody: document.getElementById("storiesTableBody"),
    deletionRequestsList: document.getElementById("deletionRequestsList"),
    reportsList: document.getElementById("reportsList")
  };

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function escapeHTML(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatRole(role) {
    const value = String(role || "user").trim().toLowerCase();
    return value || "user";
  }

  function formatStatus(status, fallback = "pending") {
    const value = String(status || fallback).trim().toLowerCase();
    return value || fallback;
  }

  function dateTime(value) {
    if (!value) {
      return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatIdentity(entity, fallback = "-") {
    if (!entity) {
      return fallback;
    }

    return entity.displayName || entity.email || entity.username || fallback;
  }

  function isPrivilegedRole(role) {
    const value = formatRole(role);
    return value === "admin" || value === "manager";
  }

  function titleCase(value) {
    const text = String(value || "").trim();
    if (!text) {
      return "";
    }

    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  }

  const compactAdminLayoutQuery = window.matchMedia("(max-width: 820px)");

  function isCompactAdminLayout() {
    return compactAdminLayoutQuery.matches;
  }

  function getAdminMobileNavActiveKey() {
    const fileName = String(window.location.pathname || "").split("/").pop().toLowerCase();
    const map = {
      "admin.html": "dashboard",
      "admin-users.html": "users",
      "admin-stories.html": "stories",
      "admin-deletion-requests.html": "requests",
      "admin-reports.html": "reports"
    };

    return map[fileName] || "dashboard";
  }

  function injectAdminMobileNav() {
    if (document.getElementById("adminMobileNav")) {
      return;
    }

    const activeKey = getAdminMobileNavActiveKey();
    const items = [
      { key: "dashboard", label: "Dashboard", href: "admin.html" },
      { key: "users", label: "Users", href: "admin-users.html" },
      { key: "stories", label: "Stories", href: "admin-stories.html" },
      { key: "requests", label: "Requests", href: "admin-deletion-requests.html" },
      { key: "reports", label: "Reports", href: "admin-reports.html" }
    ];

    const nav = document.createElement("nav");
    nav.id = "adminMobileNav";
    nav.className = "mobile-bottom-nav";
    nav.setAttribute("aria-label", "Admin quick navigation");

    items.forEach((item) => {
      const link = document.createElement("a");
      link.className = "mobile-bottom-nav-link";
      link.href = item.href;
      link.textContent = item.label;
      link.dataset.adminNav = item.key;
      if (item.key === activeKey) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
      }
      nav.appendChild(link);
    });

    document.body.appendChild(nav);
    document.body.classList.add("has-mobile-bottom-nav");
  }

  function bindResponsiveLayoutMode() {
    const rerender = () => {
      if (state.currentUser) {
        renderAll();
      }
    };

    if (typeof compactAdminLayoutQuery.addEventListener === "function") {
      compactAdminLayoutQuery.addEventListener("change", rerender);
    } else if (typeof compactAdminLayoutQuery.addListener === "function") {
      compactAdminLayoutQuery.addListener(rerender);
    }
  }

  function canManageUsers() {
    return formatRole(state.currentUser && state.currentUser.role) === "admin";
  }

  function isManagerView() {
    return formatRole(state.currentUser && state.currentUser.role) === "manager";
  }

  function getRoleWeight(role) {
    const map = {
      admin: 0,
      manager: 1,
      user: 2
    };

    return map[formatRole(role)] ?? 3;
  }

  function getActiveUsersCount() {
    return state.users.filter((user) => !user.blocked).length;
  }

  function getLatestPendingDeletionRequestForUser(userId) {
    const targetId = String(userId || "").trim();
    if (!targetId) {
      return null;
    }

    const requests = state.deletionRequests
      .filter((request) => request && request.targetUserId === targetId && formatStatus(request.status) === "pending")
      .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

    return requests[0] || null;
  }

  function setTableEmpty(container, colspan, message) {
    if (!container) {
      return;
    }

    container.innerHTML = `<tr><td colspan="${colspan}"><div class="empty">${escapeHTML(message)}</div></td></tr>`;
  }

  function ensureStatusNode() {
    const main = document.querySelector(".admin-main");
    if (!main) {
      return null;
    }

    let node = document.getElementById("adminPageStatus");
    if (!node) {
      node = document.createElement("section");
      node.id = "adminPageStatus";
      node.className = "page-status hidden";
      main.prepend(node);
    }

    return node;
  }

  function clearStatus() {
    const node = document.getElementById("adminPageStatus");
    if (!node) {
      return;
    }

    node.textContent = "";
    node.className = "page-status hidden";
  }

  function showStatus(message, type = "info", persist = false) {
    const node = ensureStatusNode();
    if (!node) {
      return;
    }

    if (statusTimer) {
      window.clearTimeout(statusTimer);
      statusTimer = null;
    }

    node.textContent = String(message || "").trim();
    node.className = `page-status ${type || "info"}`.trim();

    if (!persist) {
      statusTimer = window.setTimeout(() => {
        clearStatus();
      }, 3200);
    }
  }

  function renderLoadingState() {
    [
      elements.statTotalUsers,
      elements.statTotalStories,
      elements.statTotalReports,
      elements.statTotalViews,
      elements.statActiveUsers
    ].forEach((node) => {
      if (node) {
        node.textContent = "--";
      }
    });

    setTableEmpty(elements.usersTableBody, 4, "Loading users...");
    setTableEmpty(elements.storiesTableBody, 5, "Loading stories...");

    if (elements.deletionRequestsList) {
      elements.deletionRequestsList.innerHTML = '<div class="empty">Loading deletion requests...</div>';
    }

    if (elements.reportsList) {
      elements.reportsList.innerHTML = '<div class="empty">Loading reports...</div>';
    }
  }

  function bindStaticActions() {
    if (elements.goHomeBtn) {
      elements.goHomeBtn.addEventListener("click", () => {
        window.location.href = "home.html";
      });
    }

    if (elements.adminLogoutBtn) {
      elements.adminLogoutBtn.addEventListener("click", async () => {
        await api.logout();
        window.location.href = "index.html";
      });
    }
  }

  async function loadData() {
    const [users, stories, reports, deletionRequests] = await Promise.all([
      api.listUsers(),
      api.listStories({}, { auth: "required" }),
      api.listReports(),
      api.listUserDeletionRequests()
    ]);

    state.users = Array.isArray(users) ? users : [];
    state.stories = Array.isArray(stories) ? stories : [];
    state.reports = Array.isArray(reports) ? reports : [];
    state.deletionRequests = Array.isArray(deletionRequests) ? deletionRequests : [];
  }

  function renderStats() {
    const openReports = state.reports.filter((report) => String(report.status || "open") !== "resolved");
    const totalViews = state.stories.reduce((sum, story) => sum + Number(story && story.reads ? story.reads : 0), 0);

    if (elements.statTotalUsers) {
      elements.statTotalUsers.textContent = formatNumber(state.users.length);
    }

    if (elements.statTotalStories) {
      elements.statTotalStories.textContent = formatNumber(state.stories.length);
    }

    if (elements.statTotalReports) {
      elements.statTotalReports.textContent = formatNumber(openReports.length);
    }

    if (elements.statTotalViews) {
      elements.statTotalViews.textContent = formatNumber(totalViews);
    }

    if (elements.statActiveUsers) {
      elements.statActiveUsers.textContent = formatNumber(getActiveUsersCount());
    }
  }

  async function refreshAndRender(message, type = "success") {
    await loadData();
    renderAll();
    if (message) {
      showStatus(message, type);
    }
  }

  async function handleUserRoleToggle(user) {
    const nextRole = formatRole(user.role) === "manager" ? "user" : "manager";
    await api.updateUser(user.id, { role: nextRole });
    await refreshAndRender(
      nextRole === "manager" ? "Manager access granted." : "Manager access removed.",
      "success"
    );
  }

  async function handleUserBlockToggle(user) {
    await api.updateUser(user.id, { blocked: !user.blocked });
    await refreshAndRender(user.blocked ? "User unblocked." : "User blocked.", "success");
  }

  async function handleSendDeletionWarning(user) {
    const reason = window.prompt(`Optional deletion reason for ${user.email}:`, "");
    if (reason === null) {
      return;
    }

    const isAdminAction = canManageUsers();
    const confirmed = window.confirm(
      isAdminAction
        ? `Send deletion warning to ${user.email}? After that, admin can permanently delete this account.`
        : `Request deletion for ${user.email}? The user will be warned and the request will go to admin approval.`
    );

    if (!confirmed) {
      return;
    }

    await api.sendUserDeletionWarning(user.id, {
      reason
    });

    await refreshAndRender(
      isAdminAction
        ? "Deletion warning sent. Account is now eligible for admin delete."
        : "Deletion request sent to admin and warning delivered to the user.",
      "success"
    );
  }

  async function handleDeleteUser(user, request) {
    const isManagerRequest = formatRole(request && request.requestedBy && request.requestedBy.role) === "manager";
    const confirmed = window.confirm(
      isManagerRequest
        ? `Approve and permanently delete ${user.email}? This manager request cannot be undone.`
        : `Permanently delete ${user.email}? This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    await api.deleteUser(user.id);
    await refreshAndRender(
      isManagerRequest ? "Deletion request approved and account removed." : "Account deleted permanently.",
      "success"
    );
  }

  async function handleReviewDeletionRequest(request, action) {
    const targetEmail = request.targetEmail || formatIdentity(request.targetUser, "this user");
    const normalizedAction = formatStatus(action, "approve");
    const confirmed = window.confirm(
      normalizedAction === "approve"
        ? `Approve deletion for ${targetEmail}? This permanently deletes the account.`
        : `Reject deletion request for ${targetEmail}?`
    );

    if (!confirmed) {
      return;
    }

    await api.reviewUserDeletionRequest(request.id, {
      action: normalizedAction
    });

    await refreshAndRender(
      normalizedAction === "approve" ? "Deletion request approved and account removed." : "Deletion request rejected.",
      "success"
    );
  }

  function getUserActionState(user) {
    const role = formatRole(user.role);
    const blocked = !!user.blocked;
    const pendingRequest = getLatestPendingDeletionRequestForUser(user.id);
    const isSelf = state.currentUser && state.currentUser.id === user.id;
    const isAdminTarget = role === "admin";

    return {
      role,
      blocked,
      pendingRequest,
      isSelf,
      isAdminTarget,
      canManageUsers: canManageUsers(),
      isManagerView: isManagerView(),
      canEditUser: canManageUsers() && !isSelf && !isAdminTarget,
      canWarnUser: canManageUsers() && !isSelf && !pendingRequest,
      canDeleteUser: canManageUsers(),
      canRequestDelete: isManagerView() && !isSelf && role !== "admin" && !pendingRequest
    };
  }

  function buildUserActionsMarkup(actionState) {
    return `
      <button class="btn small ${actionState.role === "manager" ? "warn" : "success"}" data-action="manager">
        ${actionState.role === "manager" ? "Remove Manager" : "Assign Manager"}
      </button>
      <button class="btn small ${actionState.blocked ? "success" : "danger"}" data-action="block">
        ${actionState.blocked ? "Unblock User" : "Block User"}
      </button>
      ${actionState.canManageUsers ? `
        <button class="btn small warn" data-action="warn-delete">
          ${actionState.pendingRequest ? "Warning Sent" : "Send Warning"}
        </button>
        <button class="btn small danger" data-action="delete-user">
          Delete User
        </button>
      ` : ""}
      ${actionState.isManagerView ? `
        <button class="btn small danger" data-action="request-delete">
          ${actionState.pendingRequest ? "Approval Pending" : "Request Delete"}
        </button>
      ` : ""}
    `;
  }

  function bindUserRowActions(row, user, actionState) {
    const managerBtn = row.querySelector('[data-action="manager"]');
    const blockBtn = row.querySelector('[data-action="block"]');
    const warnBtn = row.querySelector('[data-action="warn-delete"]');
    const deleteBtn = row.querySelector('[data-action="delete-user"]');
    const requestBtn = row.querySelector('[data-action="request-delete"]');

    if (managerBtn) {
      managerBtn.disabled = !actionState.canEditUser;
      managerBtn.title = actionState.canEditUser
        ? ""
        : (actionState.canManageUsers ? "Admin role cannot be changed." : "Only admin can manage roles.");

      if (actionState.canEditUser) {
        managerBtn.addEventListener("click", async () => {
          try {
            managerBtn.disabled = true;
            await handleUserRoleToggle(user);
          } catch (error) {
            showStatus(api.getErrorMessage(error, "User role update failed."), "error");
            renderUsersTable();
          }
        });
      }
    }

    if (blockBtn) {
      blockBtn.disabled = !actionState.canEditUser;
      blockBtn.title = actionState.canEditUser
        ? ""
        : (actionState.canManageUsers ? "Admin account cannot be blocked." : "Only admin can manage block status.");

      if (actionState.canEditUser) {
        blockBtn.addEventListener("click", async () => {
          try {
            blockBtn.disabled = true;
            await handleUserBlockToggle(user);
          } catch (error) {
            showStatus(api.getErrorMessage(error, "User block update failed."), "error");
            renderUsersTable();
          }
        });
      }
    }

    if (warnBtn) {
      warnBtn.disabled = !actionState.canWarnUser;
      warnBtn.title = actionState.canWarnUser
        ? ""
        : (actionState.isSelf
          ? "You cannot delete your own account."
          : (actionState.pendingRequest ? "A deletion warning is already pending." : ""));

      if (actionState.canWarnUser) {
        warnBtn.addEventListener("click", async () => {
          try {
            warnBtn.disabled = true;
            await handleSendDeletionWarning(user);
          } catch (error) {
            showStatus(api.getErrorMessage(error, "Deletion warning failed."), "error");
            renderUsersTable();
          }
        });
      }
    }

    if (deleteBtn) {
      deleteBtn.disabled = !actionState.canDeleteUser;
      deleteBtn.title = actionState.canDeleteUser
        ? ""
        : "Only admin can delete users.";

      if (actionState.canDeleteUser) {
        deleteBtn.addEventListener("click", async () => {
          try {
            deleteBtn.disabled = true;
            await handleDeleteUser(user, actionState.pendingRequest);
          } catch (error) {
            showStatus(api.getErrorMessage(error, "Account delete failed."), "error");
            renderUsersTable();
          }
        });
      }
    }

    if (requestBtn) {
      requestBtn.disabled = !actionState.canRequestDelete;
      requestBtn.title = actionState.canRequestDelete
        ? ""
        : (actionState.isSelf
          ? "You cannot request deletion of your own account."
          : (actionState.role === "admin"
            ? "Manager cannot request deletion of an admin."
            : (actionState.pendingRequest ? "Deletion approval is already pending." : "")));

      if (actionState.canRequestDelete) {
        requestBtn.addEventListener("click", async () => {
          try {
            requestBtn.disabled = true;
            await handleSendDeletionWarning(user);
          } catch (error) {
            showStatus(api.getErrorMessage(error, "Deletion request failed."), "error");
            renderUsersTable();
          }
        });
      }
    }
  }

  function bindAccordionToggle(row) {
    const toggle = row.querySelector("[data-accordion-toggle]");
    const panel = row.querySelector("[data-accordion-panel]");
    if (!toggle || !panel) {
      return;
    }

    toggle.addEventListener("click", () => {
      const open = row.classList.toggle("open");
      panel.classList.toggle("hidden", !open);
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  function buildStoryActionsMarkup() {
    return `
      <div class="cell-actions">
        <button class="btn small danger" data-action="delete">Delete Story</button>
      </div>
    `;
  }

  function bindStoryRowActions(row, story) {
    const deleteBtn = row.querySelector('[data-action="delete"]');
    if (!deleteBtn) {
      return;
    }

    deleteBtn.addEventListener("click", async () => {
      const title = story.title || "this story";
      const confirmed = window.confirm(`Delete "${title}"?`);
      if (!confirmed) {
        return;
      }

      try {
        deleteBtn.disabled = true;
        await api.deleteStory(story.id);
        await refreshAndRender(`"${title}" deleted.`, "success");
      } catch (error) {
        deleteBtn.disabled = false;
        showStatus(api.getErrorMessage(error, "Story delete failed."), "error");
      }
    });
  }

  function renderUsersTable() {
    if (!elements.usersTableBody) {
      return;
    }

    const sortedUsers = [...state.users].sort((left, right) => {
      const roleGap = getRoleWeight(left.role) - getRoleWeight(right.role);
      if (roleGap !== 0) {
        return roleGap;
      }

      return normalizeEmail(left.email).localeCompare(normalizeEmail(right.email));
    });

    elements.usersTableBody.innerHTML = "";

    if (!sortedUsers.length) {
      setTableEmpty(elements.usersTableBody, 4, "No users found.");
      return;
    }

    const compactLayout = isCompactAdminLayout();

    sortedUsers.forEach((user, index) => {
      const actionState = getUserActionState(user);

      if (compactLayout) {
        const panelId = `adminUserPanel-${index}`;
        const deletionLabel = actionState.pendingRequest
          ? `Pending since ${dateTime(actionState.pendingRequest.createdAt)}`
          : (actionState.isManagerView ? "No request yet" : "No pending request");
        const row = document.createElement("tr");
        row.className = "accordion-row";
        row.innerHTML = `
          <td colspan="4">
            <div class="accordion-card">
              <button class="accordion-toggle" type="button" aria-expanded="false" aria-controls="${panelId}" data-accordion-toggle>
                <div class="accordion-summary-main">
                  <strong>${escapeHTML(user.email)}</strong>
                  <div class="accordion-summary-meta">
                    <span class="role ${escapeHTML(actionState.role)}">${escapeHTML(actionState.role)}</span>
                    <span class="status ${actionState.blocked ? "blocked" : "active"}">${actionState.blocked ? "Blocked" : "Active"}</span>
                  </div>
                </div>
                <div class="accordion-summary-side">
                  <span class="accordion-summary-sub">${actionState.pendingRequest ? "Deletion warning pending" : "Tap for actions"}</span>
                  <span class="accordion-caret">v</span>
                </div>
              </button>
              <div id="${panelId}" class="accordion-panel hidden" data-accordion-panel>
                <div class="accordion-detail-grid">
                  <div class="accordion-field">
                    <span>Email</span>
                    <strong>${escapeHTML(user.email)}</strong>
                  </div>
                  <div class="accordion-field">
                    <span>Role</span>
                    <strong>${escapeHTML(titleCase(actionState.role))}</strong>
                  </div>
                  <div class="accordion-field">
                    <span>Status</span>
                    <strong>${actionState.blocked ? "Blocked" : "Active"}</strong>
                  </div>
                  <div class="accordion-field">
                    <span>Deletion</span>
                    <strong>${escapeHTML(deletionLabel)}</strong>
                  </div>
                </div>
                <div class="cell-actions accordion-actions">
                  ${buildUserActionsMarkup(actionState)}
                </div>
              </div>
            </div>
          </td>
        `;

        bindAccordionToggle(row);
        bindUserRowActions(row, user, actionState);
        elements.usersTableBody.appendChild(row);
        return;
      }

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHTML(user.email)}</td>
        <td><span class="role ${escapeHTML(actionState.role)}">${escapeHTML(actionState.role)}</span></td>
        <td><span class="status ${actionState.blocked ? "blocked" : "active"}">${actionState.blocked ? "Blocked" : "Active"}</span></td>
        <td>
          <div class="cell-actions">
            ${buildUserActionsMarkup(actionState)}
          </div>
        </td>
      `;

      bindUserRowActions(row, user, actionState);
      elements.usersTableBody.appendChild(row);
    });
  }

  function renderDeletionRequests() {
    if (!elements.deletionRequestsList) {
      return;
    }

    const requests = [...state.deletionRequests].sort((left, right) => {
      return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    });

    elements.deletionRequestsList.innerHTML = "";

    if (!requests.length) {
      elements.deletionRequestsList.innerHTML = '<div class="empty">No deletion requests yet.</div>';
      return;
    }

    requests.forEach((request) => {
      const status = formatStatus(request.status, "pending");
      const targetLabel = formatIdentity(request.targetUser, request.targetEmail || "-");
      const requesterLabel = formatIdentity(request.requestedBy, request.requestedByEmail || "-");
      const reviewerLabel = formatIdentity(request.reviewedBy, request.reviewedByEmail || "-");

      const card = document.createElement("article");
      card.className = "report-card";
      card.innerHTML = `
        <div class="report-head">
          <strong>${escapeHTML(targetLabel)}</strong>
          <span class="status ${escapeHTML(status)}">${escapeHTML(status)}</span>
        </div>
        <p class="report-sub">Requested by: ${escapeHTML(requesterLabel)}</p>
        <p class="report-sub">Reason: ${escapeHTML(request.reason || "-")}</p>
        <p class="report-sub">Warning sent: ${escapeHTML(dateTime(request.warningSentAt))}</p>
        <p class="report-sub">Created: ${escapeHTML(dateTime(request.createdAt))}</p>
        <p class="report-sub">Reviewed by: ${escapeHTML(status === "pending" ? "-" : reviewerLabel)}</p>
        <div class="cell-actions">
          ${canManageUsers() && status === "pending" ? `
            <button class="btn small success" data-action="approve">Approve Delete</button>
            <button class="btn small warn" data-action="reject">Reject</button>
          ` : ""}
        </div>
      `;

      const approveBtn = card.querySelector('[data-action="approve"]');
      const rejectBtn = card.querySelector('[data-action="reject"]');

      if (approveBtn) {
        approveBtn.addEventListener("click", async () => {
          try {
            approveBtn.disabled = true;
            await handleReviewDeletionRequest(request, "approve");
          } catch (error) {
            showStatus(api.getErrorMessage(error, "Deletion approval failed."), "error");
            renderDeletionRequests();
          }
        });
      }

      if (rejectBtn) {
        rejectBtn.addEventListener("click", async () => {
          try {
            rejectBtn.disabled = true;
            await handleReviewDeletionRequest(request, "reject");
          } catch (error) {
            showStatus(api.getErrorMessage(error, "Deletion rejection failed."), "error");
            renderDeletionRequests();
          }
        });
      }

      elements.deletionRequestsList.appendChild(card);
    });
  }

  function renderStoriesTable() {
    if (!elements.storiesTableBody) {
      return;
    }

    const stories = [...state.stories].sort((left, right) => {
      return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
    });

    elements.storiesTableBody.innerHTML = "";

    if (!stories.length) {
      setTableEmpty(elements.storiesTableBody, 5, "No stories found.");
      return;
    }

    const compactLayout = isCompactAdminLayout();

    stories.forEach((story, index) => {
      const owner = (story.author && (story.author.displayName || story.author.email || story.author.username)) || "-";
      const status = formatStatus(story.status || "draft", "draft");

      if (compactLayout) {
        const panelId = `adminStoryPanel-${index}`;
        const row = document.createElement("tr");
        row.className = "accordion-row";
        row.innerHTML = `
          <td colspan="5">
            <div class="accordion-card">
              <button class="accordion-toggle" type="button" aria-expanded="false" aria-controls="${panelId}" data-accordion-toggle>
                <div class="accordion-summary-main">
                  <strong>${escapeHTML(story.title || "Untitled Story")}</strong>
                  <div class="accordion-summary-meta">
                    <span>${escapeHTML(owner)}</span>
                    <span class="status ${escapeHTML(status)}">${escapeHTML(titleCase(status))}</span>
                  </div>
                </div>
                <div class="accordion-summary-side">
                  <span class="accordion-summary-sub">${formatNumber(story.reads || 0)} views</span>
                  <span class="accordion-caret">v</span>
                </div>
              </button>
              <div id="${panelId}" class="accordion-panel hidden" data-accordion-panel>
                <div class="accordion-detail-grid">
                  <div class="accordion-field">
                    <span>Story</span>
                    <strong>${escapeHTML(story.title || "Untitled Story")}</strong>
                  </div>
                  <div class="accordion-field">
                    <span>Owner</span>
                    <strong>${escapeHTML(owner)}</strong>
                  </div>
                  <div class="accordion-field">
                    <span>Status</span>
                    <strong>${escapeHTML(titleCase(status))}</strong>
                  </div>
                  <div class="accordion-field">
                    <span>Views</span>
                    <strong>${formatNumber(story.reads || 0)}</strong>
                  </div>
                </div>
                ${buildStoryActionsMarkup()}
              </div>
            </div>
          </td>
        `;

        bindAccordionToggle(row);
        bindStoryRowActions(row, story);
        elements.storiesTableBody.appendChild(row);
        return;
      }

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHTML(story.title || "Untitled Story")}</td>
        <td>${escapeHTML(owner)}</td>
        <td><span class="status ${escapeHTML(status)}">${escapeHTML(titleCase(status))}</span></td>
        <td>${formatNumber(story.reads || 0)}</td>
        <td>${buildStoryActionsMarkup()}</td>
      `;

      bindStoryRowActions(row, story);
      elements.storiesTableBody.appendChild(row);
    });
  }

  function renderReports() {
    if (!elements.reportsList) {
      return;
    }

    const reports = [...state.reports].sort((left, right) => {
      return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    });

    elements.reportsList.innerHTML = "";

    if (!reports.length) {
      elements.reportsList.innerHTML = '<div class="empty">No reports yet.</div>';
      return;
    }

    reports.forEach((report) => {
      const status = String(report.status || "open") === "resolved" ? "resolved" : "open";
      const reporter = report.reportedBy && (report.reportedBy.email || report.reportedBy.username || report.reportedBy.displayName)
        ? (report.reportedBy.email || report.reportedBy.username || report.reportedBy.displayName)
        : "-";

      const card = document.createElement("article");
      card.className = "report-card";
      card.innerHTML = `
        <div class="report-head">
          <strong>${escapeHTML(report.storyTitle || "Story Report")}</strong>
          <span class="status ${status}">${status === "resolved" ? "Resolved" : "Open"}</span>
        </div>
        <p class="report-sub">Reporter: ${escapeHTML(reporter)}</p>
        <p class="report-sub">Reason: ${escapeHTML(report.reason || "Content report")}</p>
        <p class="report-sub">Details: ${escapeHTML(report.details || "-")}</p>
        <p class="report-sub">Time: ${escapeHTML(dateTime(report.createdAt))}</p>
        <div class="cell-actions">
          <button class="btn small ${status === "resolved" ? "warn" : "success"}" data-action="toggle">
            ${status === "resolved" ? "Reopen" : "Mark Resolved"}
          </button>
          <button class="btn small danger" data-action="delete">Delete Report</button>
        </div>
      `;

      const toggleBtn = card.querySelector('[data-action="toggle"]');
      const deleteBtn = card.querySelector('[data-action="delete"]');

      if (toggleBtn) {
        toggleBtn.addEventListener("click", async () => {
          try {
            toggleBtn.disabled = true;
            await api.updateReport(report.id, {
              status: status === "resolved" ? "open" : "resolved"
            });
            await refreshAndRender(status === "resolved" ? "Report reopened." : "Report marked resolved.", "success");
          } catch (error) {
            toggleBtn.disabled = false;
            showStatus(api.getErrorMessage(error, "Report update failed."), "error");
          }
        });
      }

      if (deleteBtn) {
        deleteBtn.addEventListener("click", async () => {
          try {
            deleteBtn.disabled = true;
            await api.deleteReport(report.id);
            await refreshAndRender("Report deleted.", "success");
          } catch (error) {
            deleteBtn.disabled = false;
            showStatus(api.getErrorMessage(error, "Report delete failed."), "error");
          }
        });
      }

      elements.reportsList.appendChild(card);
    });
  }

  function renderAll() {
    renderStats();
    renderUsersTable();
    renderDeletionRequests();
    renderStoriesTable();
    renderReports();
  }

  async function initialize() {
    const existingSession = api.getSession();
    if (!existingSession) {
      window.location.href = "index.html";
      return;
    }

    state.session = await api.hydrateCurrentUser();
    state.currentUser = state.session && state.session.user ? state.session.user : null;

    if (!state.currentUser || !isPrivilegedRole(state.currentUser.role)) {
      window.location.href = "home.html";
      return;
    }

    if (elements.adminUserLine) {
      elements.adminUserLine.textContent = state.currentUser.email || "Admin";
    }

    bindStaticActions();
    bindResponsiveLayoutMode();
    injectAdminMobileNav();
    renderLoadingState();
    showStatus("Loading admin dashboard...", "info", true);
    await loadData();
    renderAll();
    clearStatus();
  }

  initialize().catch(async (error) => {
    const message = api.getErrorMessage(error, "Admin dashboard load failed.");

    if (error && error.status === 401) {
      await api.logout();
      window.location.href = "index.html";
      return;
    }

    if (error && error.status === 403) {
      window.location.href = "home.html";
      return;
    }

    if (elements.deletionRequestsList) {
      elements.deletionRequestsList.innerHTML = `<div class="empty">${escapeHTML(message)}</div>`;
    }
    if (elements.reportsList) {
      elements.reportsList.innerHTML = `<div class="empty">${escapeHTML(message)}</div>`;
    }
    showStatus(message, "error", true);
  });
})();
