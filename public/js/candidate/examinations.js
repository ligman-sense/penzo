'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError } from '../notifications.js';
import {
  formatDate, renderExamCard, escapeHtml,
  getQueryParam, setQueryParam, debounce,
  renderPagination, showElement, hideElement
} from '../utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let _page       = 1;
let _pageSize   = 12;
let _totalPages = 1;
let _filters    = { search: '', authority: '', region: '', dateFrom: '' };
let _user       = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const grid         = document.getElementById('exams-grid');
const paginationEl = document.getElementById('pagination');
const searchInput  = document.getElementById('exam-search');
const authorityEl  = document.getElementById('filter-authority');
const regionEl     = document.getElementById('filter-region');
const dateFromEl   = document.getElementById('filter-date-from');
const clearFilters = document.getElementById('clear-filters');
const loadingEl    = document.getElementById('loading-indicator');
const modal        = document.getElementById('exam-modal');
const modalContent = document.getElementById('exam-modal-content');
const modalClose   = document.getElementById('modal-close');

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  initTheme();
  _user = await requireAuth('/login.html');
  if (!_user) return;

  initNavigation();
  updateUnreadCount();

  // Restore filters from URL
  _filters.search    = getQueryParam('search')    || '';
  _filters.authority = getQueryParam('authority') || '';
  _filters.region    = getQueryParam('region')    || '';
  _filters.dateFrom  = getQueryParam('dateFrom')  || '';
  _page              = parseInt(getQueryParam('page') || '1', 10);

  // Pre-fill filter inputs
  if (searchInput  && _filters.search)    searchInput.value    = _filters.search;
  if (authorityEl  && _filters.authority) authorityEl.value    = _filters.authority;
  if (regionEl     && _filters.region)    regionEl.value       = _filters.region;
  if (dateFromEl   && _filters.dateFrom)  dateFromEl.value     = _filters.dateFrom;

  setupFilters();
  setupModal();
  await loadExams();

  // If exam slug passed in URL, open modal
  const slug = getQueryParam('exam');
  if (slug) openExamBySlug(slug);
})();

// ─── Load Exams ───────────────────────────────────────────────────────────────
async function loadExams() {
  if (loadingEl) loadingEl.hidden = false;
  if (grid)      grid.innerHTML   = '';

  const params = new URLSearchParams({
    page:     _page,
    pageSize: _pageSize,
  });
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
      if (grid) grid.innerHTML = '<p class="empty-state" role="status">No examinations found. Try adjusting your filters.</p>';
      if (paginationEl) paginationEl.innerHTML = '';
      return;
    }

    if (grid) grid.innerHTML = exams.map(e => renderExamCard(e, _user.role)).join('');
    if (paginationEl) renderPagination(paginationEl, { page: _page, totalPages: _totalPages }, goToPage);

    // Attach "View Details" clicks to open modal
    grid?.querySelectorAll('.btn--ghost').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const slug = new URL(btn.href).searchParams.get('exam');
        if (slug) openExamBySlug(slug);
      });
    });

  } catch (err) {
    if (loadingEl) loadingEl.hidden = true;
    if (grid) grid.innerHTML = '<p class="text-error" role="alert">Failed to load examinations. Please try again.</p>';
    showError(err.message || 'Could not fetch examinations.');
  }
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
    setQueryParam('page',      '1');
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
      ['search','authority','region','dateFrom','page'].forEach(k => setQueryParam(k, ''));
      loadExams();
    });
  }
}

// ─── Exam Detail Modal ────────────────────────────────────────────────────────
function setupModal() {
  if (!modal) return;
  if (modalClose) {
    modalClose.addEventListener('click', closeModal);
  }
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });
}

async function openExamBySlug(slug) {
  if (!modal || !modalContent) return;
  setQueryParam('exam', slug);
  modal.hidden = false;
  modalContent.innerHTML = '<p class="loading-text">Loading exam details…</p>';
  document.body.style.overflow = 'hidden';
  modalClose?.focus();

  try {
    const { data } = await api.get(`/public/examinations/${slug}`);
    renderExamModal(data.examination || data);
  } catch (err) {
    modalContent.innerHTML = '<p class="text-error">Failed to load exam details.</p>';
  }
}

function renderExamModal(exam) {
  const sessions = exam.sessions?.map(s =>
    `<li>${escapeHtml(s.name || s.type)}: ${formatDate(s.date)} at ${escapeHtml(s.venue || '')}</li>`
  ).join('') || '<li>No session info available.</li>';

  const locations = exam.locations?.map(l =>
    `<li>${escapeHtml(l.city)}${l.centre ? ` — ${escapeHtml(l.centre)}` : ''}</li>`
  ).join('') || '<li>Multiple locations</li>';

  const rules = exam.rules?.map(r => `<li>${escapeHtml(r)}</li>`).join('') || '';

  modalContent.innerHTML = `
    <header class="modal__header">
      ${exam.isFeatured ? '<span class="badge badge--accent">Featured</span>' : ''}
      <h2 class="modal__title">${escapeHtml(exam.name)}</h2>
      <p class="modal__authority">${escapeHtml(exam.authority)}</p>
    </header>
    <div class="modal__body">
      ${exam.description ? `<p class="modal__description">${escapeHtml(exam.description)}</p>` : ''}
      <dl class="modal__meta">
        <div><dt>Exam Date</dt><dd>${formatDate(exam.startsOn)}</dd></div>
        ${exam.endsOn ? `<div><dt>End Date</dt><dd>${formatDate(exam.endsOn)}</dd></div>` : ''}
        ${exam.registrationDeadline ? `<div><dt>Registration Deadline</dt><dd>${formatDate(exam.registrationDeadline)}</dd></div>` : ''}
      </dl>
      <h3>Locations</h3>
      <ul>${locations}</ul>
      <h3>Sessions</h3>
      <ul>${sessions}</ul>
      ${rules ? `<h3>Rules for Scribes</h3><ul>${rules}</ul>` : ''}
      ${exam.infoUrl ? `<p><a href="${escapeHtml(exam.infoUrl)}" target="_blank" rel="noopener" class="link">Official Notification ↗</a></p>` : ''}
    </div>
    <div class="modal__footer">
      <a href="/candidate/request-form.html?examId=${exam.id}" class="btn btn--primary">Request Scribe</a>
      <button class="btn btn--ghost" onclick="document.getElementById('exam-modal').hidden=true;document.body.style.overflow=''">Close</button>
    </div>`;
}

function closeModal() {
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  setQueryParam('exam', '');
}
