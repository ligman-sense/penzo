'use strict';

import { api } from '../api.js';
import { requireAdmin } from '../auth.js';
import { showError, showSuccess } from '../notifications.js';
import { getQueryParam, setLoading } from '../utils.js';

let examId = null;

document.addEventListener('DOMContentLoaded', async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  examId = getQueryParam('id');
  const pageTitle = document.getElementById('form-page-title');
  const form = document.getElementById('examination-form');
  const submitBtn = document.getElementById('submit-btn');

  if (examId) {
    if (pageTitle) pageTitle.textContent = 'Edit Examination';
    loadExamination(examId);
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoading(submitBtn, true, 'Saving...');

    const payload = {
      name: document.getElementById('name')?.value.trim(),
      authority: document.getElementById('authority')?.value.trim(),
      description: document.getElementById('description')?.value.trim(),
      officialUrl: document.getElementById('officialUrl')?.value.trim(),
      notificationUrl: document.getElementById('notificationUrl')?.value.trim(),
      registrationOpensAt: document.getElementById('registrationOpensAt')?.value || null,
      registrationDeadline: document.getElementById('registrationDeadline')?.value || null,
      startsOn: document.getElementById('startsOn')?.value || null,
      endsOn: document.getElementById('endsOn')?.value || null,
      isFeatured: document.getElementById('isFeatured')?.checked || false,
      scribeEligibilityInfo: document.getElementById('scribeEligibilityInfo')?.value.trim(),
      qualificationConditions: document.getElementById('qualificationConditions')?.value.trim(),
      requiredDocuments: document.getElementById('requiredDocuments')?.value.trim(),
      accommodationInfo: document.getElementById('accommodationInfo')?.value.trim(),
      scribeRequestInstructions: document.getElementById('scribeRequestInstructions')?.value.trim(),
      adminNotes: document.getElementById('adminNotes')?.value.trim(),
    };

    try {
      if (examId) {
        await api.put(`/admin/examinations/${examId}`, payload);
        showSuccess('Examination updated successfully.');
      } else {
        await api.post('/admin/examinations', payload);
        showSuccess('Examination created successfully.');
      }
      setTimeout(() => {
        window.location.href = '/admin/examinations.html';
      }, 1000);
    } catch (err) {
      showError(err.message || 'Failed to save examination.');
    } finally {
      setLoading(submitBtn, false);
    }
  });
});

async function loadExamination(id) {
  try {
    const { data } = await api.get(`/admin/examinations/${id}`);
    if (!data) return;

    const fields = [
      'name', 'authority', 'description', 'officialUrl', 'notificationUrl',
      'scribeEligibilityInfo', 'qualificationConditions', 'requiredDocuments',
      'accommodationInfo', 'scribeRequestInstructions', 'adminNotes',
    ];

    fields.forEach((f) => {
      const el = document.getElementById(f);
      if (el && data[f]) el.value = data[f];
    });

    if (data.isFeatured) {
      const el = document.getElementById('isFeatured');
      if (el) el.checked = true;
    }

    if (data.startsOn) {
      const el = document.getElementById('startsOn');
      if (el) el.value = data.startsOn.slice(0, 10);
    }
    if (data.endsOn) {
      const el = document.getElementById('endsOn');
      if (el) el.value = data.endsOn.slice(0, 10);
    }
    if (data.registrationOpensAt) {
      const el = document.getElementById('registrationOpensAt');
      if (el) el.value = data.registrationOpensAt.slice(0, 10);
    }
    if (data.registrationDeadline) {
      const el = document.getElementById('registrationDeadline');
      if (el) el.value = data.registrationDeadline.slice(0, 10);
    }
  } catch (err) {
    showError(err.message || 'Failed to load examination.');
  }
}
