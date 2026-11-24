'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError, showSuccess } from '../notifications.js';
import {
  formatDate, escapeHtml,
  getQueryParam, setQueryParam, debounce,
  renderPagination, setLoading
} from '../utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let _page       = 1;
let _pageSize   = 12;
let _totalPages = 1;
let _filters    = { search: '', authority: '', region: '', dateFrom: '' };
let _user       = null;
let _interests  = new Map(); // examinationId -> interest status

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const grid         = document.getElementById('exams-grid');
const paginationEl = document.getElementById('pagination');
const searchInput  = document.getElementById('exam-search');
const authorityEl  = document.getElementById('filter-authority');
const regionEl     = document.getElementById('filter-region');
const dateFromEl   = document.getElementById('filter-date-from');
const clearFilters = document.getElementById('clear-filters');
const loadingEl    = document.getElementById('loading-indicator');

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  initTheme();
  _user = await requireAuth('/login.html');
  if (!_user) return;

  if (_user.role !== 'VOLUNTEER') {
    window.location.href = '/candidate/examinations.html';
    return;
  }

  initNavigation();
  updateUnreadCount();

  _filters.search    = getQueryParam('search')    || '';
  _filters.authority = getQueryParam('authority') || '';
  _filters.region    = getQueryParam('region')    || '';
  _filters.dateFrom  = getQueryParam('dateFrom')  || '';
  _page              = parseInt(getQueryParam('page') || '1', 10);

  if (searchInput  && _filters.search)    searchInput.value = _filters.search;
  if (authorityEl  && _filters.authority) authorityEl.value = _filters.authority;
  if (regionEl     && _filters.region)    regionEl.value    = _filters.region;
  if (dateFromEl   && _filters.dateFrom)  dateFromEl.value  = _filters.dateFrom;

  // Load existing interests to mark cards
  await loadMyInterests();
  setupFilters();
  await loadExams();
})();

// ─── Interests Map ────────────────────────────────────────────────────────────
async function loadMyInterests() {
  try {
    const { data } = await api.get('/interests');
    const interests = data.interests || data.items || [];
    interests.forEach(i => _interests.set(i.examinationId, i.status));
  } catch {
    // Non-critical — proceed without interest state
  }
}

// ─── Load Exams ───────────────────────────────────────────────────────────────
async function loadExams() {
  if (loadingEl) loadingEl.hidden = false;
  if (grid)      grid.innerHTML   = '';

  const params = new URLSearchParams({ page: _page, pageSize: _pageSize });
  if (_filters.search)    params.set('search',    _filters.search);
  if (_filters.authority) params.set('authority', _filters.authority);
  if (_filters.region)    params.set('region',    _filters.region);
  if (_filters.dateFrom)  params.set('dateFrom',  _filters.dateFrom);

  try {
    const res = await api.get(`/public/examinations?${params.toString()}`);
    const exams     = Array.isArray(res.data) ? res.data : (res.data?.examinations || res.data?.items || []);
    _totalPages     = res.meta?.totalPages || res.data?.totalPages || 1;

    if (loadingEl) loadingEl.hidden = true;

    if (!exams.length) {
      if (grid) grid.innerHTML = '<p class="empty-state" role="status">No examinations found.</p>';
      if (paginationEl) paginationEl.innerHTML = '';
      return;
    }

    if (grid) grid.innerHTML = exams.map(e => renderVolunteerExamCard(e)).join('');
    attachInterestHandlers();
    if (paginationEl) renderPagination(paginationEl, { page: _page, totalPages: _totalPages }, goToPage);

  } catch (err) {
    if (loadingEl) loadingEl.hidden = true;
    if (grid) grid.innerHTML = '<p class="text-error" role="alert">Failed to load examinations.</p>';
    showError(err.message || 'Could not fetch examinations.');
  }
}

// ─── Volunteer Exam Card ──────────────────────────────────────────────────────
function renderVolunteerExamCard(exam) {
  const dateText     = exam.startsOn ? formatDate(exam.startsOn) : 'Date TBD';
  const locationText = exam.locations?.map(l => l.city).join(', ') || 'Multiple locations';
  const interestStatus = _interests.get(exam.id);

  let actionBtn;
  if (interestStatus === 'WITHDRAWN') {
    actionBtn = `<button class="btn btn--secondary btn--sm interest-btn" data-exam-id="${exam.id}">Re-express Interest</button>`;
  } else if (interestStatus) {
    actionBtn = `<span class="badge badge--green interest-status" data-exam-id="${exam.id}">Interest Registered ✓</span>`;
  } else {
    actionBtn = `<button class="btn btn--secondary btn--sm interest-btn" data-exam-id="${exam.id}">I'm Interested</button>`;
  }

  return `<article class="exam-card" aria-label="${escapeHtml(exam.name)}" data-exam-id="${exam.id}">
    <div class="exam-card__header">
      ${exam.isFeatured ? '<span class="badge badge--accent">Featured</span>' : ''}
      <h3 class="exam-card__title">${escapeHtml(exam.name)}</h3>
      <p class="exam-card__authority">${escapeHtml(exam.authority)}</p>
    </div>
    <div class="exam-card__body">
      <dl class="exam-card__meta">
        <div><dt>Date</dt><dd>${dateText}</dd></div>
        <div><dt>Location</dt><dd>${escapeHtml(locationText)}</dd></div>
        ${exam.registrationDeadline ? `<div><dt>Deadline</dt><dd>${formatDate(exam.registrationDeadline)}</dd></div>` : ''}
      </dl>
      ${exam.description ? `<p class="exam-card__desc">${escapeHtml(exam.description.slice(0, 150))}${exam.description.length > 150 ? '...' : ''}</p>` : ''}
    </div>
    <div class="exam-card__footer">
      ${actionBtn}
    </div>
  </article>`;
}

// ─── Interest Button Handlers ─────────────────────────────────────────────────
function attachInterestHandlers() {
  grid?.querySelectorAll('.interest-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const examId = btn.dataset.examId;
      setLoading(btn, true, 'Registering…');

      try {
        const { data } = await api.put(`/interests/${examId}`, {});
        _interests.set(examId, data.interest?.status || 'REGISTERED');
        showSuccess('Interest registered! We\'ll notify you when matched.');

        // Update the button in place
        const statusEl = document.createElement('span');
        statusEl.className = 'badge badge--green interest-status';
        statusEl.dataset.examId = examId;
        statusEl.textContent = 'Interest Registered ✓';
        btn.replaceWith(statusEl);
      } catch (err) {
        showError(err.message || 'Failed to register interest.');
        setLoading(btn, false);
      }
    });
  });
}

function goToPage(p) {
  _page = p;
  setQueryParam('page', p);
  loadExams();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Filters ──────────────────────────────────────────────────────────────────
function setupFilters() {
  const applyFilters = () => {
    _filters.search    = searchInput?.value.trim()  || '';
    _filters.authority = authorityEl?.value.trim()  || '';
    _filters.region    = regionEl?.value.trim()     || '';
    _filters.dateFrom  = dateFromEl?.value          || '';
    _page = 1;
    setQueryParam('search',    _filters.search);
    setQueryParam('authority', _filters.authority);
    setQueryParam('region',    _filters.region);
    setQueryParam('dateFrom',  _filters.dateFrom);
    loadExams();
  };

  const debouncedSearch = debounce(applyFilters, 400);

  if (searchInput)  searchInput.addEventListener('input',  debouncedSearch);
  if (authorityEl)  authorityEl.addEventListener('change', applyFilters);
  if (regionEl)     regionEl.addEventListener('change',    applyFilters);
  if (dateFromEl)   dateFromEl.addEventListener('change',  applyFilters);

  if (clearFilters) {
    clearFilters.addEventListener('click', () => {
      _filters = { search: '', authority: '', region: '', dateFrom: '' };
      if (searchInput) searchInput.value = '';
      if (authorityEl) authorityEl.value = '';
      if (regionEl)    regionEl.value    = '';
      if (dateFromEl)  dateFromEl.value  = '';
      _page = 1;
      ['search','authority','region','dateFrom'].forEach(k => setQueryParam(k, ''));
      loadExams();
    });
  }
}
