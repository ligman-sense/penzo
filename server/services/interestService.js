'use strict';

const VolunteerInterest = require('../models/VolunteerInterest');
const Examination = require('../models/Examination');
const {
  checkVolunteerConflict,
  getExamTimeRange,
  findVolunteerScheduleConflict,
} = require('../utils/conflictChecker');
const { HttpError } = require('../utils/httpError');

async function listInterests(volunteerId) {
  const items = await VolunteerInterest.find({ volunteerId })
    .populate('examinationId', 'name title slug authority startsOn endsOn locations status')
    .sort({ updatedAt: -1 });

  return items.map((i) => {
    const exam = i.examinationId;
    return {
      id: i._id.toString(),
      examinationId: exam ? exam._id.toString() : i.examinationId?.toString(),
      status: i.status,
      notes: i.notes,
      qualificationsConfirmed: i.qualificationsConfirmed,
      languagesConfirmed: i.languagesConfirmed,
      availabilityConfirmed: i.availabilityConfirmed,
      locationConfirmed: i.locationConfirmed,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      registeredAt: i.createdAt,
      examination: exam ? {
        id: exam._id.toString(),
        name: exam.name || exam.title,
        authority: exam.authority,
        slug: exam.slug,
        startsOn: exam.startsOn,
        endsOn: exam.endsOn,
        status: exam.status,
      } : null,
    };
  });
}

async function setInterest(volunteerId, examinationId, data) {
  const exam = await Examination.findById(examinationId);
  if (!exam || exam.status !== 'PUBLISHED') {
    throw HttpError.notFound('Published examination not found.');
  }

  // Prevent double-booking if volunteer already has a confirmed assignment during this examination
  const { startsAt, endsAt } = getExamTimeRange(exam);
  if (startsAt && endsAt) {
    const scheduleConflict = await findVolunteerScheduleConflict(volunteerId, { startsAt, endsAt });
    if (scheduleConflict.hasConflict && scheduleConflict.conflictType === 'CONFIRMED_ASSIGNMENT') {
      throw HttpError.conflict('Cannot register interest: You already have a confirmed scribe assignment during this examination schedule.');
    }
  }

  // Check for conflicts with existing confirmed assignments
  let targetSession = null;
  if (data?.sessionId && exam.sessions) {
    targetSession = exam.sessions.id(data.sessionId) || exam.sessions.find(s => s._id.toString() === data.sessionId.toString());
  } else if (exam.sessions && exam.sessions.length === 1) {
    targetSession = exam.sessions[0];
  }

  const conflict = await checkVolunteerConflict(volunteerId, exam, targetSession);
  if (conflict.hasConflict) {
    throw HttpError.conflict('Cannot register interest: You already have a confirmed scribe assignment during this examination schedule.');
  }

  const interest = await VolunteerInterest.findOneAndUpdate(
    { volunteerId, examinationId },
    {
      status: 'ACTIVE',
      notes: data.notes || null,
      qualificationsConfirmed: Boolean(data.qualificationsConfirmed),
      languagesConfirmed: Boolean(data.languagesConfirmed),
      availabilityConfirmed: Boolean(data.availabilityConfirmed),
      locationConfirmed: Boolean(data.locationConfirmed),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return interest;
}

async function withdrawInterest(volunteerId, examinationId) {
  const interest = await VolunteerInterest.findOne({ volunteerId, examinationId });
  if (!interest) throw HttpError.notFound('Interest record not found.');

  interest.status = 'WITHDRAWN';
  await interest.save();
  return { id: interest._id.toString(), status: 'WITHDRAWN' };
}

module.exports = {
  listInterests,
  setInterest,
  withdrawInterest,
};
