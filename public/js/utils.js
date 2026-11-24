'use strict';

export function formatDate(dateStr) {
  if (!dateStr) return 'TBD';
  return new Date(dateStr).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatDateTime(dateStr) {
  if (!dateStr) return 'TBD';
  return new Date(dateStr).toLocaleString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return 'just now';
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)} minutes ago`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)} hours ago`;
  if (diffSecs < 2592000) return `${Math.floor(diffSecs / 86400)} days ago`;
  return formatDate(dateStr);
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function setQueryParam(name, value) {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(name, value); else params.delete(name);
  history.replaceState(null, '', `?${params.toString()}`);
}

export function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

export function showElement(el) { if (el) el.hidden = false; }
export function hideElement(el) { if (el) el.hidden = true; }

export function setLoading(btn, loading, originalText) {
  if (loading) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.dataset.originalText = btn.textContent;
    btn.textContent = originalText || 'Loading...';
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = btn.dataset.originalText || 'Submit';
  }
}

export function renderPagination(container, { page, totalPages }, onPageChange) {
  container.innerHTML = '';
  if (totalPages <= 1) return;

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Pagination');
  nav.className = 'pagination';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'pagination__btn';
  prevBtn.textContent = 'Previous';
  prevBtn.disabled = page <= 1;
  prevBtn.addEventListener('click', () => onPageChange(page - 1));
  nav.appendChild(prevBtn);

  const info = document.createElement('span');
  info.className = 'pagination__info';
  info.textContent = `Page ${page} of ${totalPages}`;
  nav.appendChild(info);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'pagination__btn';
  nextBtn.textContent = 'Next';
  nextBtn.disabled = page >= totalPages;
  nextBtn.addEventListener('click', () => onPageChange(page + 1));
  nav.appendChild(nextBtn);

  container.appendChild(nav);
}

export const STATUS_LABELS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PENDING_REVIEW: 'Under Review',
  AWAITING_VOLUNTEER: 'Finding Volunteer',
  MATCH_PROPOSED: 'Match Proposed',
  VOLUNTEER_ACCEPTED: 'Volunteer Accepted',
  AWAITING_CANDIDATE_CONFIRMATION: 'Awaiting Confirmation',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Not Approved',
  CANCELLED: 'Cancelled',
  REPLACEMENT_REQUIRED: 'Replacement Needed',
  COMPLETED: 'Completed',
};

export const STATUS_CLASSES = {
  DRAFT: 'badge--gray',
  SUBMITTED: 'badge--blue',
  PENDING_REVIEW: 'badge--yellow',
  AWAITING_VOLUNTEER: 'badge--orange',
  MATCH_PROPOSED: 'badge--purple',
  VOLUNTEER_ACCEPTED: 'badge--indigo',
  AWAITING_CANDIDATE_CONFIRMATION: 'badge--teal',
  CONFIRMED: 'badge--green',
  REJECTED: 'badge--red',
  CANCELLED: 'badge--gray-dark',
  REPLACEMENT_REQUIRED: 'badge--orange-dark',
  COMPLETED: 'badge--green-muted',
};

export function renderStatusBadge(status) {
  const label = STATUS_LABELS[status] || status;
  const cls = STATUS_CLASSES[status] || 'badge--gray';
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

export function renderExamCard(exam, userRole) {
  const dateText = exam.startsOn ? formatDate(exam.startsOn) : 'Date TBD';
  const locationText = exam.locations?.map(l => l.city).join(', ') || 'Multiple locations';
  const actionBtn = userRole === 'VOLUNTEER'
    ? `<a href="/volunteer/examinations.html?id=${exam.id}" class="btn btn--secondary btn--sm">Express Interest</a>`
    : `<a href="/candidate/request-form.html?examId=${exam.id}" class="btn btn--primary btn--sm">Request Scribe</a>`;

  return `<article class="exam-card" aria-label="${escapeHtml(exam.name)}">
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
      <a href="/candidate/examinations.html?exam=${exam.slug}" class="btn btn--ghost btn--sm">View Details</a>
    </div>
  </article>`;
}
