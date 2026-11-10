'use strict';

export const CANDIDATE_FIELD_LABELS = {
  fullName: 'Full Name',
  languages: 'Languages Known',
  city: 'City',
  education: 'Education',
  assistanceNeeds: 'Assistance Needs',
};

export const VOLUNTEER_FIELD_LABELS = {
  fullName: 'Full Name',
  languages: 'Languages Known',
  subjects: 'Subjects',
  city: 'City',
};

function normalizeArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

export function computeCandidateCompletion(data) {
  const missing = [];
  const total = 5;

  if (!data) {
    const all = ['fullName', 'languages', 'city', 'education', 'assistanceNeeds'];
    return {
      percentage: 0,
      isComplete: false,
      completedCount: 0,
      totalCount: total,
      missingFields: all,
      missingLabels: all.map((f) => CANDIDATE_FIELD_LABELS[f] || f),
    };
  }

  const fullName = (data.fullName || `${data.firstName || ''} ${data.lastName || ''}`).trim();
  if (!fullName) missing.push('fullName');

  const langs = normalizeArray(data.languages);
  if (langs.length === 0) missing.push('languages');

  const city = (data.city || data.address?.city || '').trim();
  if (!city) missing.push('city');

  const education = (data.education || '').trim();
  if (!education) missing.push('education');

  const assistance = (data.assistanceNeeds || data.disabilityType || '').trim();
  if (!assistance) missing.push('assistanceNeeds');

  const completed = total - missing.length;
  let percentage = Math.round((completed / total) * 100);
  percentage = Math.max(0, Math.min(100, percentage));
  if (missing.length > 0 && percentage === 100) percentage = 99;

  return {
    percentage,
    isComplete: missing.length === 0,
    completedCount: completed,
    totalCount: total,
    missingFields: missing,
    missingLabels: missing.map((f) => CANDIDATE_FIELD_LABELS[f] || f),
  };
}

export function computeVolunteerCompletion(data) {
  const missing = [];
  const total = 4;

  if (!data) {
    const all = ['fullName', 'languages', 'subjects', 'city'];
    return {
      percentage: 0,
      isComplete: false,
      completedCount: 0,
      totalCount: total,
      missingFields: all,
      missingLabels: all.map((f) => VOLUNTEER_FIELD_LABELS[f] || f),
    };
  }

  const fullName = (data.fullName || `${data.firstName || ''} ${data.lastName || ''}`).trim();
  if (!fullName) missing.push('fullName');

  const langs = normalizeArray(data.languages || data.preferredLanguages);
  if (langs.length === 0) missing.push('languages');

  const subjects = normalizeArray(data.subjects);
  if (subjects.length === 0) missing.push('subjects');

  const city = (data.city || data.address?.city || '').trim();
  if (!city) missing.push('city');

  const completed = total - missing.length;
  let percentage = Math.round((completed / total) * 100);
  percentage = Math.max(0, Math.min(100, percentage));
  if (missing.length > 0 && percentage === 100) percentage = 99;

  return {
    percentage,
    isComplete: missing.length === 0,
    completedCount: completed,
    totalCount: total,
    missingFields: missing,
    missingLabels: missing.map((f) => VOLUNTEER_FIELD_LABELS[f] || f),
  };
}

/**
 * Renders an accessible profile completion widget into containerEl.
 * @param {HTMLElement} containerEl
 * @param {Object} completion - Result from computeCandidateCompletion or computeVolunteerCompletion
 * @param {Object} options - { hasUnsavedChanges: boolean, roleColor: string }
 */
export function renderCompletionWidget(containerEl, completion, options = {}) {
  if (!containerEl) return;

  const pct = completion.percentage ?? 0;
  const completed = completion.completedCount ?? 0;
  const total = completion.totalCount ?? 5;
  const missingLabels = completion.missingLabels || [];
  const hasUnsaved = Boolean(options.hasUnsavedChanges);
  const barColor = options.roleColor || 'var(--color-primary, #2563eb)';

  const ariaValueText = `${pct} percent complete, ${completed} of ${total} required items done`;

  containerEl.innerHTML = `
    <div class="completion-widget" style="display: flex; flex-direction: column; gap: 0.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 600; font-size: 0.95rem; color: var(--color-text);">
          Profile Completion: <span style="font-weight: 700; color: ${barColor};">${pct}%</span>
          <span style="font-size: 0.825rem; font-weight: normal; color: var(--color-text-muted); margin-left: 0.5rem;">
            (${completed} of ${total} required items done)
          </span>
        </span>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <span class="badge badge--yellow" id="unsaved-changes-badge" style="display: ${hasUnsaved ? 'inline-flex' : 'none'}; font-size: 0.75rem;">
            Unsaved changes
          </span>
          ${completion.isComplete ? '<span class="badge badge--green" style="font-size: 0.75rem;">Complete</span>' : ''}
        </div>
      </div>

      <div class="progress-bar-track" style="background-color: var(--color-surface-2, #e2e8f0); height: 10px; border-radius: 6px; overflow: hidden; position: relative;">
        <div class="progress-bar-fill"
             role="progressbar"
             aria-valuenow="${pct}"
             aria-valuemin="0"
             aria-valuemax="100"
             aria-valuetext="${ariaValueText}"
             style="background-color: ${barColor}; height: 100%; width: ${pct}%; border-radius: 6px; transition: width 0.3s ease;">
        </div>
      </div>

      <div class="completion-status-text" aria-live="polite" style="font-size: 0.85rem; color: var(--color-text-muted);">
        ${completion.isComplete
          ? '<span style="color: var(--color-success, #16a34a); font-weight: 500;">✓ All required profile details are complete.</span>'
          : `<span>Still required: <strong style="color: var(--color-text);">${missingLabels.join(', ')}</strong></span>`
        }
      </div>
    </div>
  `;
}
