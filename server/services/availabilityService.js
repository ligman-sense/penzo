'use strict';

const VolunteerAvailability = require('../models/VolunteerAvailability');
const { HttpError } = require('../utils/httpError');

async function listAvailability(volunteerId) {
  const items = await VolunteerAvailability.find({ volunteerId }).sort({ startsAt: 1 });
  return items.map((a) => ({
    id: a._id.toString(),
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    status: a.status,
    createdAt: a.createdAt,
  }));
}

async function addAvailability(volunteerId, data) {
  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);

  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw HttpError.badRequest('Invalid date/time range.');
  }

  // Prevent overlapping availability
  const overlap = await VolunteerAvailability.findOne({
    volunteerId,
    startsAt: { $lt: endsAt },
    endsAt: { $gt: startsAt },
  });
  if (overlap) {
    throw HttpError.conflict('This availability slot overlaps with an existing slot.');
  }

  const slot = await VolunteerAvailability.create({
    volunteerId,
    startsAt,
    endsAt,
    status: 'OPEN',
  });

  return {
    id: slot._id.toString(),
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    status: slot.status,
  };
}

async function removeAvailability(volunteerId, id) {
  const slot = await VolunteerAvailability.findOne({ _id: id, volunteerId });
  if (!slot) throw HttpError.notFound('Availability slot not found.');

  if (slot.status === 'COMMITTED') {
    throw HttpError.badRequest('Cannot remove an availability slot committed to an assignment.');
  }

  await VolunteerAvailability.deleteOne({ _id: id });
  return { id, removed: true };
}

module.exports = {
  listAvailability,
  addAvailability,
  removeAvailability,
};
