'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError, showSuccess } from '../notifications.js';
import { formatDate, escapeHtml, getQueryParam, setLoading } from '../utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let _user = null;
let _profile = null;
let _selectedExam = null;
let _allExams = [];

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const form            = document.getElementById('scribe-request-form');
const examSelect      = document.getElementById('examination-select');
const sessionSelect   = document.getElementById('session-select');
const sessionGroup    = document.getElementById('session-group');
const cityInput       = document.getElementById('city');
const languageInput   = document.getElementById('language');
const reqTextarea     = document.getElementById('requirements');
const summaryContent  = document.getElementById('exam-summary-content');
const profileWarning  = document.getElementById('profile-warning');
const submitBtn       = document.getElementById('submit-request-btn');

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  initTheme();
  _user = await requireAuth('/login.html');
  if (!_user) return;

  if (_user.role !== 'CANDIDATE') {
    window.location.href = '/volunteer/dashboard.html';
    return;
  }

  initNavigation();
  updateUnreadCount();

  const nameEl = document.querySelector('.user-name, #user-name');
  if (nameEl) nameEl.textContent = _user.name || _user.mobile || 'Candidate';

  await loadCandidateProfile();
  await loadExaminations();
  setupEvents();
})();

// ─── Candidate Profile ────────────────────────────────────────────────────────
async function loadCandidateProfile() {
  try {
    const { data } = await api.get('/profile');
    _profile = data.profile || data;

    const isComplete = data.profileComplete || data.completion?.isComplete;
    if (!isComplete) {
      if (profileWarning) profileWarning.style.display = 'block';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.title = 'Please complete your candidate profile first.';
      }
    } else {
      if (profileWarning) profileWarning.style.display = 'none';
      if (submitBtn) submitBtn.disabled = false;
    }

    // Pre-fill fields from profile
    if (cityInput && !cityInput.value && _profile.city) {
      cityInput.value = _profile.city;
    }
    if (languageInput && !languageInput.value && _profile.languages) {
      const langs = Array.isArray(_profile.languages) ? _profile.languages : [_profile.languages];
      cityInput && (_profile.preferredExamCity ? cityInput.value = _profile.preferredExamCity : null);
      languageInput.value = langs.join(', ');
    }
    if (reqTextarea && !reqTextarea.value && (_profile.assistanceNeeds || _profile.disabilityType)) {
      reqTextarea.value = _profile.assistanceNeeds || _profile.disabilityType;
    }
  } catch (err) {
    showError('Could not verify profile status. Please check your network.');
  }
}

// ─── Load Examinations ────────────────────────────────────────────────────────
async function loadExaminations() {
  try {
    const res = await api.get('/public/examinations?pageSize=50');
    _allExams = Array.isArray(res.data) ? res.data : (res.data?.examinations || res.data?.items || []);

    if (examSelect) {
      examSelect.innerHTML = '<option value="">Select an examination</option>' +
        _allExams.map(e => `<option value="${e.id}">${escapeHtml(e.name)} (${escapeHtml(e.authority)})</option>`).join('');
    }

    // Check query params for examId or exam slug
    const paramExamId = getQueryParam('examId');
    const paramExamSlug = getQueryParam('exam');

    let initialExamId = null;
    if (paramExamId) {
      initialExamId = paramExamId;
    } else if (paramExamSlug) {
      const matched = _allExams.find(e => e.slug === paramExamSlug);
      if (matched) initialExamId = matched.id;
    }

    if (initialExamId && examSelect) {
      examSelect.value = initialExamId;
      await selectExam(initialExamId);
    } else if (_allExams.length > 0 && examSelect) {
      // If none in param, select first one by default
      examSelect.value = _allExams[0].id;
      await selectExam(_allExams[0].id);
    } else {
      if (summaryContent) {
        summaryContent.innerHTML = '<p class="empty-state">No examinations currently available for requests.</p>';
      }
    }
  } catch (err) {
    if (summaryContent) {
      summaryContent.innerHTML = '<p class="text-error">Failed to load examinations.</p>';
    }
    showError(err.message || 'Could not fetch examination list.');
  }
}

// ─── Select Examination ───────────────────────────────────────────────────────
async function selectExam(examId) {
  if (!examId) {
    _selectedExam = null;
    if (summaryContent) summaryContent.innerHTML = '<p class="empty-state">Please select an examination above.</p>';
    if (sessionSelect) sessionSelect.innerHTML = '<option value="">Select session</option>';
    return;
  }

  if (summaryContent) summaryContent.innerHTML = '<p class="loading-text">Loading examination details...</p>';

  try {
    const { data } = await api.get(`/public/examinations/${examId}`);
    _selectedExam = data.examination || data;
    renderExamSummary(_selectedExam);
    renderSessionOptions(_selectedExam);
  } catch (err) {
    // Fall back to exam in list if direct get fails
    _selectedExam = _allExams.find(e => e.id === examId) || null;
    if (_selectedExam) {
      renderExamSummary(_selectedExam);
      renderSessionOptions(_selectedExam);
    } else {
      if (summaryContent) summaryContent.innerHTML = '<p class="text-error">Could not load examination details.</p>';
    }
  }
}

function renderExamSummary(exam) {
  if (!summaryContent || !exam) return;

  const dateStr = exam.startsOn ? formatDate(exam.startsOn) : 'Date TBD';
  const locationsStr = exam.locations?.map(l => l.city).join(', ') || 'Multiple locations';

  summaryContent.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem;">
      <div>
        <h2 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 0.25rem;">${escapeHtml(exam.name)}</h2>
        <p style="color: var(--color-primary); font-weight: 600; font-size: 0.9rem;">${escapeHtml(exam.authority)}</p>
      </div>
      ${exam.isFeatured ? '<span class="badge badge--accent">Featured</span>' : ''}
    </div>

    <div class="grid grid-cols-3" style="gap: 1rem; margin-bottom: 1rem; font-size: 0.85rem; background: var(--color-surface-2); padding: 0.75rem; border-radius: 6px;">
      <div><strong>Date:</strong> <span>${dateStr}</span></div>
      <div><strong>Locations:</strong> <span>${escapeHtml(locationsStr)}</span></div>
      <div><strong>Deadline:</strong> <span>${exam.registrationDeadline ? formatDate(exam.registrationDeadline) : 'Open'}</span></div>
    </div>

    ${exam.rules && exam.rules.length ? `
      <div style="margin-top: 0.75rem;">
        <strong style="font-size: 0.85rem; color: var(--color-text-muted);">Scribe Instructions / Rules:</strong>
        <ul style="font-size: 0.85rem; padding-left: 1.25rem; margin-top: 0.25rem;">
          ${exam.rules.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
        </ul>
      </div>
    ` : ''}
  `;
}

function renderSessionOptions(exam) {
  if (!sessionSelect) return;

  if (exam.sessions && exam.sessions.length > 0) {
    if (sessionGroup) sessionGroup.style.display = 'block';
    sessionSelect.innerHTML = '<option value="">Select an examination session</option>' +
      exam.sessions.map(s => {
        const timeText = s.startsAt ? ` (${formatDate(s.startsAt)})` : (s.date ? ` (${formatDate(s.date)})` : '');
        return `<option value="${s._id || s.id}">${escapeHtml(s.name || s.label || s.type || 'Session')}${timeText}</option>`;
      }).join('');
  } else {
    // If no explicit sessions, offer exam default
    if (sessionGroup) sessionGroup.style.display = 'none';
    sessionSelect.innerHTML = `<option value="" selected>Default Exam Session (${exam.startsOn ? formatDate(exam.startsOn) : 'Main Session'})</option>`;
  }
}

// ─── Setup Events ─────────────────────────────────────────────────────────────
function setupEvents() {
  if (examSelect) {
    examSelect.addEventListener('change', (e) => {
      selectExam(e.target.value);
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const examId = examSelect?.value;
      if (!examId) {
        showError('Please select an examination.');
        return;
      }

      const city = cityInput?.value.trim();
      if (!city) {
        showError('Exam Centre City is required.');
        cityInput?.focus();
        return;
      }

      const language = languageInput?.value.trim();
      if (!language) {
        showError('Preferred scribe language is required.');
        languageInput?.focus();
        return;
      }

      const sessionId = sessionSelect?.value || undefined;
      const requirements = reqTextarea?.value.trim() || undefined;

      const payload = {
        examinationId: examId,
        sessionId,
        city,
        language,
        requirements,
      };

      setLoading(submitBtn, true, 'Submitting Request…');

      try {
        const res = await api.post('/requests', payload);
        const createdReq = res.data?.request || res.data;
        const requestId = createdReq.id || createdReq._id;

        showSuccess('Scribe request submitted successfully!');
        setTimeout(() => {
          window.location.href = `/candidate/request-details.html?id=${requestId}`;
        }, 1200);
      } catch (err) {
        setLoading(submitBtn, false);
        if (err.data?.error?.code === 'PROFILE_INCOMPLETE' || err.message?.toLowerCase().includes('profile')) {
          showError(err.message || 'Please complete your candidate profile before submitting.');
          if (profileWarning) profileWarning.style.display = 'block';
        } else if (err.status === 409) {
          showError('You already have an active request for this examination. Check My Scribe Requests.');
        } else {
          showError(err.message || 'Failed to submit scribe request. Please try again.');
        }
      }
    });
  }
}
