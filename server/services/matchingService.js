'use strict';

const User = require('../models/User');
const VolunteerProfile = require('../models/VolunteerProfile');
const VolunteerAvailability = require('../models/VolunteerAvailability');
const ConfirmedAssignment = require('../models/ConfirmedAssignment');
const MatchProposal = require('../models/MatchProposal');
const ScribeRequest = require('../models/ScribeRequest');
const Examination = require('../models/Examination');
const RequestStatusHistory = require('../models/RequestStatusHistory');
const { assertTransition } = require('./requestStateMachine');
const { notify } = require('./notificationService');
const { HttpError } = require('../utils/httpError');

/**
 * Calculate match score and compatibility breakdown.
 */
function scoreVolunteer(request, exam, session, volunteer, profile, availability, assignments) {
  let score = 0;
  const breakdown = {};
  const reasons = [];
  let hasBlockingFailure = false;

  // 1. Mandatory check: Overlapping confirmed commitments
  if (session && session.startsAt && session.endsAt) {
    const sStart = new Date(session.startsAt);
    const sEnd = new Date(session.endsAt);
    const hasOverlap = assignments.some((a) => {
      if (a.status !== 'CONFIRMED') return false;
      const aStart = new Date(a.startsAt);
      const aEnd = new Date(a.endsAt);
      return aStart < sEnd && aEnd > sStart;
    });

    if (hasOverlap) {
      hasBlockingFailure = true;
      reasons.push('Volunteer has an overlapping confirmed assignment.');
    }
  }

  // 2. Date/Time Availability (30%)
  let dateTimeScore = 0;
  if (session && session.startsAt && session.endsAt) {
    const sStart = new Date(session.startsAt);
    const sEnd = new Date(session.endsAt);
    const isAvail = availability.some((av) => {
      if (av.status !== 'OPEN') return false;
      const avStart = new Date(av.startsAt);
      const avEnd = new Date(av.endsAt);
      return avStart <= sStart && avEnd >= sEnd;
    });

    if (isAvail) {
      dateTimeScore = 30;
      reasons.push('Available during the exact examination session.');
    } else {
      dateTimeScore = 10;
      reasons.push('General availability requires confirmation.');
    }
  } else {
    dateTimeScore = 15;
  }
  breakdown.dateTime = dateTimeScore;
  score += dateTimeScore;

  // 3. Location compatibility (25%)
  let locationScore = 0;
  const reqCity = (request.city || '').toLowerCase().trim();
  const volCity = (profile.city || '').toLowerCase().trim();
  const servLocations = (profile.serviceLocations || []).map((l) => l.toLowerCase().trim());

  if (reqCity && (volCity === reqCity || servLocations.includes(reqCity))) {
    locationScore = 25;
    reasons.push(`Located in or serves candidate exam city (${request.city}).`);
  } else if (volCity) {
    locationScore = 10;
    reasons.push(`Based in ${profile.city}; travel may be required.`);
  } else {
    locationScore = 5;
  }
  breakdown.location = locationScore;
  score += locationScore;

  // 4. Language compatibility (20%)
  let langScore = 0;
  const reqLang = (request.language || '').toLowerCase().trim();
  const volLangs = (profile.languages || []).map((l) => l.toLowerCase().trim());

  if (reqLang && volLangs.includes(reqLang)) {
    langScore = 20;
    reasons.push(`Fluent in requested language: ${request.language}.`);
  } else if (volLangs.length > 0) {
    langScore = 5;
    reasons.push(`Languages spoken: ${profile.languages.join(', ')}.`);
  }
  breakdown.language = langScore;
  score += langScore;

  // 5. Qualification/Rules (15%)
  let qualScore = 15;
  if (profile.educationLevel) {
    reasons.push(`Education level: ${profile.educationLevel}.`);
  }
  breakdown.qualification = qualScore;
  score += qualScore;

  // 6. Relevant Experience (10%)
  let expScore = 0;
  if (profile.hasPriorExperience || profile.hasScribeExperience) {
    expScore = 10;
    reasons.push('Has prior scribe examination experience.');
  } else {
    expScore = 5;
    reasons.push('New volunteer scribe.');
  }
  breakdown.experience = expScore;
  score += expScore;

  return {
    score: Math.min(100, Math.max(0, score)),
    scoreBreakdown: breakdown,
    compatibility: { reasons },
    hasBlockingFailure,
  };
}

/**
 * Generate potential match proposals for a scribe request.
 */
async function findPotentialMatches(requestId) {
  const request = await ScribeRequest.findById(requestId).populate('examinationId');
  if (!request) throw HttpError.notFound('Request not found.');

  const exam = request.examinationId;
  let session = null;
  if (exam && exam.sessions && request.sessionId) {
    session = exam.sessions.id(request.sessionId) || exam.sessions.find(s => s._id.toString() === request.sessionId.toString());
  }

  // Active volunteers with complete profiles
  const volunteers = await User.find({ role: 'VOLUNTEER', status: 'ACTIVE', profileComplete: true });

  const results = [];
  for (const vol of volunteers) {
    const profile = await VolunteerProfile.findOne({ userId: vol._id });
    if (!profile) continue;

    const availability = await VolunteerAvailability.find({ volunteerId: vol._id });
    const assignments = await ConfirmedAssignment.find({ volunteerId: vol._id });

    const scored = scoreVolunteer(request, exam, session, vol, profile, availability, assignments);

    results.push({
      volunteerId: vol._id.toString(),
      volunteerName: profile.fullName || (profile.firstName ? `${profile.firstName} ${profile.lastName}` : 'Volunteer'),
      volunteerCity: profile.city,
      languages: profile.languages,
      score: scored.score,
      scoreBreakdown: scored.scoreBreakdown,
      compatibility: scored.compatibility,
      hasBlockingFailure: scored.hasBlockingFailure,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

module.exports = {
  scoreVolunteer,
  findPotentialMatches,
};
