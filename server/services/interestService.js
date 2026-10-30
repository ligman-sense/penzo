'use strict';

const VolunteerInterest = require('../models/VolunteerInterest');
const Examination = require('../models/Examination');
const { HttpError } = require('../utils/httpError');

async function listInterests(volunteerId) {
  const items = await VolunteerInterest.find({ volunteerId })
    .populate('examinationId', 'name title slug authority startsOn endsOn locations status')
    .sort({ updatedAt: -1 });

  return items.map((i) => {
    const exam = i.examinationId;
    return {
      id: i._id.toString(),
      status: i.status,
      notes: i.notes,
      qualificationsConfirmed: i.qualificationsConfirmed,
      languagesConfirmed: i.languagesConfirmed,
      availabilityConfirmed: i.availabilityConfirmed,
      locationConfirmed: i.locationConfirmed,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
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
