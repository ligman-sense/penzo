'use strict';
/**
 * PENZO Development Seed Script
 *
 * Creates clearly-labelled FICTIONAL data for development and demonstration.
 * ⚠ This script CANNOT run when NODE_ENV=production.
 * ⚠ All generated records are fictional — do NOT use real examination data,
 *   real mobile numbers, or real personal information in this file.
 */

require('dotenv').config();

const env = require('../server/config/env');
if (env.NODE_ENV === 'production') {
  console.error('ERROR: seed.js cannot run in production. Set NODE_ENV=development.');
  process.exit(1);
}

const mongoose = require('mongoose');

// ─── Models ──────────────────────────────────────────────────────────────────
// We import models after connecting so Mongoose is ready.

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected.');

  // Require models here so Mongoose is already initialised
  const User = require('../server/models/User');
  const CandidateProfile = require('../server/models/CandidateProfile');
  const VolunteerProfile = require('../server/models/VolunteerProfile');
  const Examination = require('../server/models/Examination');
  const FAQ = require('../server/models/FAQ');
  const { hashPassword } = require('../server/utils/password');
  const AdminUser = require('../server/models/AdminUser');

  // ─── Safety check ──────────────────────────────────────────────────────────
  const existingExams = await Examination.countDocuments({ isSampleData: true });
  if (existingExams > 0) {
    console.log(`Seed data already present (${existingExams} sample examinations). Skipping.`);
    console.log('To re-seed, manually remove documents with isSampleData:true from MongoDB first.');
    await mongoose.disconnect();
    return;
  }

  // ─── Admin (bootstrap if not exists) ───────────────────────────────────────
  if (env.ADMIN_BOOTSTRAP_EMAIL && env.ADMIN_BOOTSTRAP_PASSWORD) {
    const existingAdmin = await AdminUser.findOne({ email: env.ADMIN_BOOTSTRAP_EMAIL });
    if (!existingAdmin) {
      await AdminUser.create({
        email: env.ADMIN_BOOTSTRAP_EMAIL,
        name: 'Demo Administrator',
        passwordHash: await hashPassword(env.ADMIN_BOOTSTRAP_PASSWORD),
      });
      console.log(`Created admin: ${env.ADMIN_BOOTSTRAP_EMAIL}`);
    } else {
      console.log(`Admin already exists: ${env.ADMIN_BOOTSTRAP_EMAIL}`);
    }
  }

  // ─── Sample Examinations ───────────────────────────────────────────────────
  console.log('Creating sample examinations (fictional demo data)...');

  const nextYear = new Date().getFullYear() + 1;
  const examinations = await Examination.insertMany([
    {
      name: '[DEMO] Fictional State Civil Services Preliminary Examination',
      slug: 'demo-fictional-state-civil-services-prelim',
      authority: 'Fictional State Public Service Commission (Demo)',
      description:
        'This is a FICTIONAL demonstration examination record created by the PENZO seed script. ' +
        'It does not represent any real government examination. ' +
        'It is included for UI testing purposes only.',
      officialUrl: 'https://example.invalid/demo-exam',
      notificationUrl: 'https://example.invalid/demo-notification',
      registrationOpensAt: new Date(`${nextYear}-01-15`),
      registrationDeadline: new Date(`${nextYear}-02-28`),
      startsOn: new Date(`${nextYear}-04-15`),
      endsOn: new Date(`${nextYear}-04-15`),
      status: 'PUBLISHED',
      isFeatured: true,
      isSampleData: true,
      informationSource: 'Fictional seed data — not a real examination',
      lastVerifiedAt: new Date(),
      scribeEligibilityInfo:
        'FICTIONAL DEMO DATA: In this fictional exam, candidates with locomotor disability or visual impairment may request a scribe subject to the applicable rules. Always verify with the actual examination authority.',
      qualificationConditions: 'DEMO: The volunteer scribe must not be a graduate in the subject being examined.',
      requiredDocuments: 'DEMO: Candidate disability certificate (fictional), Scribe undertaking form (fictional)',
      accommodationInfo: 'DEMO: Candidates using scribes are entitled to 20 minutes extra time per hour, subject to the official rules.',
      scribeRequestInstructions: 'DEMO: Submit your scribe request through PENZO at least 15 days before the examination date. This is fictional data.',
      adminNotes: 'Seed data — remove before going live',
      locations: [
        { city: 'Demo City', state: 'Demo State', region: 'South' },
        { city: 'Sample Town', state: 'Demo State', region: 'North' },
      ],
      sessions: [
        {
          label: 'Morning Session (Demo)',
          startsAt: new Date(`${nextYear}-04-15T09:00:00Z`),
          endsAt: new Date(`${nextYear}-04-15T12:00:00Z`),
          location: { city: 'Demo City', state: 'Demo State' },
        },
        {
          label: 'Afternoon Session (Demo)',
          startsAt: new Date(`${nextYear}-04-15T14:00:00Z`),
          endsAt: new Date(`${nextYear}-04-15T17:00:00Z`),
          location: { city: 'Sample Town', state: 'Demo State' },
        },
      ],
      rules: [
        {
          category: 'ELIGIBILITY',
          title: 'Who may request a scribe (Demo)',
          body: 'FICTIONAL: Candidates with benchmark disability as defined in the Rights of Persons with Disabilities Act may request a scribe. This is demo data.',
          sourceUrl: 'https://example.invalid',
          requiresAdminReview: false,
        },
        {
          category: 'QUALIFICATION',
          title: 'Volunteer qualification (Demo)',
          body: 'FICTIONAL: The scribe should not be a graduate in the same subject as the paper being written. Verify with the actual authority.',
          sourceUrl: 'https://example.invalid',
          requiresAdminReview: false,
        },
      ],
    },
    {
      name: '[DEMO] Fictional National Entrance Test for Postgraduate Programmes',
      slug: 'demo-fictional-national-pg-entrance',
      authority: 'Fictional National Testing Body (Demo)',
      description:
        'Another FICTIONAL demonstration examination. This record is created by the PENZO seed script. ' +
        'No real examination information is implied.',
      officialUrl: 'https://example.invalid/demo-pg-exam',
      registrationDeadline: new Date(`${nextYear}-03-31`),
      startsOn: new Date(`${nextYear}-06-10`),
      endsOn: new Date(`${nextYear}-06-12`),
      status: 'PUBLISHED',
      isFeatured: false,
      isSampleData: true,
      informationSource: 'Fictional seed data',
      lastVerifiedAt: new Date(),
      scribeEligibilityInfo: 'FICTIONAL DEMO: Refer to the official notification for scribe eligibility criteria.',
      scribeRequestInstructions: 'DEMO: Submit your scribe request well in advance. PENZO will notify you when a potential volunteer match is found.',
      adminNotes: 'Seed data — remove before going live',
      locations: [
        { city: 'Metro City', state: 'Demo State', region: 'Central' },
      ],
      sessions: [
        {
          label: 'Day 1 - Paper 1 (Demo)',
          startsAt: new Date(`${nextYear}-06-10T10:00:00Z`),
          endsAt: new Date(`${nextYear}-06-10T13:00:00Z`),
          location: { city: 'Metro City', state: 'Demo State' },
        },
      ],
      rules: [],
    },
    {
      name: '[DEMO] Fictional District Court Recruitment Test',
      slug: 'demo-fictional-district-court-recruitment',
      authority: 'Fictional High Court Administration (Demo)',
      description: 'FICTIONAL demo examination for testing draft/unpublished status display in admin.',
      status: 'DRAFT',
      isFeatured: false,
      isSampleData: true,
      informationSource: 'Fictional seed data',
      adminNotes: 'Draft seed exam — for testing admin draft views',
      locations: [],
      sessions: [],
      rules: [],
    },
  ]);

  console.log(`Created ${examinations.length} sample examinations.`);

  // ─── Sample Candidates ─────────────────────────────────────────────────────
  console.log('Creating sample candidate users (fictional mobile numbers in +000 range)...');

  const candidateUser = await User.create({
    role: 'CANDIDATE',
    mobileE164: '+00012345001',  // Fictional — +000 is not a real country code
    mobileVerifiedAt: new Date(),
    email: 'demo.candidate@example.invalid',
    status: 'ACTIVE',
    profileComplete: true,
    termsAcceptedAt: new Date(),
    privacyAcceptedAt: new Date(),
  });

  await CandidateProfile.create({
    userId: candidateUser._id,
    fullName: 'Demo Candidate (Fictional)',
    languages: ['English', 'Hindi'],
    education: 'Bachelor of Arts (Fiction University)',
    city: 'Demo City',
    preferredExamCity: 'Demo City',
    assistanceNeeds: 'Requires a scribe due to locomotor disability (fictional — demo data only)',
  });

  await User.findByIdAndUpdate(candidateUser._id, { profileComplete: true });

  // ─── Sample Volunteers ─────────────────────────────────────────────────────
  console.log('Creating sample volunteer users...');

  const volunteerUser = await User.create({
    role: 'VOLUNTEER',
    mobileE164: '+00012345002',
    mobileVerifiedAt: new Date(),
    email: 'demo.volunteer@example.invalid',
    status: 'ACTIVE',
    profileComplete: true,
    termsAcceptedAt: new Date(),
    privacyAcceptedAt: new Date(),
  });

  await VolunteerProfile.create({
    userId: volunteerUser._id,
    fullName: 'Demo Volunteer (Fictional)',
    educationLevel: 'Postgraduate',
    institution: 'Fiction University',
    languages: ['English', 'Hindi', 'Tamil'],
    subjects: ['Mathematics', 'Science', 'General Studies'],
    city: 'Demo City',
    serviceRadiusKm: 30,
    serviceLocations: ['Demo City', 'Sample Town'],
    hasPriorExperience: false,
  });

  await User.findByIdAndUpdate(volunteerUser._id, { profileComplete: true });

  console.log('Created sample candidate and volunteer users.');

  // ─── Sample FAQs ───────────────────────────────────────────────────────────
  console.log('Creating sample FAQs...');

  await FAQ.insertMany([
    {
      question: 'What is PENZO?',
      answer:
        'PENZO is an independent coordination platform that helps candidates who require scribe assistance for government examinations connect with potential volunteer scribes. It is not an official government portal.',
      category: 'General',
      sortOrder: 1,
      isPublished: true,
    },
    {
      question: 'Who is a scribe?',
      answer:
        'A scribe (also called an amanuensis or writer) is a person who writes on behalf of a candidate with a disability during an examination. The candidate dictates their answers and the scribe writes them down.',
      category: 'General',
      sortOrder: 2,
      isPublished: true,
    },
    {
      question: 'Does PENZO guarantee that a matched volunteer will be approved?',
      answer:
        'No. A match proposed by PENZO is a potential match only. Final eligibility and approval of a scribe remain subject to the rules of the relevant examination authority. Always check the official notification and follow the prescribed process.',
      category: 'General',
      sortOrder: 3,
      isPublished: true,
    },
    {
      question: 'How do I log in to PENZO?',
      answer:
        'PENZO uses a mobile OTP (one-time password) system. Enter your mobile number, receive a 6-digit code via SMS, and enter it to sign in. No password is required.',
      category: 'Candidates',
      sortOrder: 4,
      isPublished: true,
    },
    {
      question: 'I am a volunteer. What information do I need to provide?',
      answer:
        'Volunteers are asked to provide their name, educational qualification, languages they can support, subjects they can write for, their city and service radius, and their availability. This information helps match them with suitable candidates.',
      category: 'Volunteers',
      sortOrder: 5,
      isPublished: true,
    },
    {
      question: 'Is my personal information safe?',
      answer:
        'PENZO collects only the information necessary to coordinate scribe assistance. Mobile numbers are never shown publicly. Verification documents are stored privately and are accessible only to administrators. Please read the Privacy Policy for full details.',
      category: 'Privacy',
      sortOrder: 6,
      isPublished: true,
    },
    {
      question: 'Can I cancel a scribe request?',
      answer:
        'You can cancel a request before a volunteer has been confirmed. Once a scribe assignment is confirmed, cancellation is still possible but may require a reason and will be handled according to the platform\'s cancellation policy.',
      category: 'Candidates',
      sortOrder: 7,
      isPublished: true,
    },
  ]);

  console.log('Created sample FAQs.');

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete!');
  console.log('   Sample examinations:', examinations.length);
  console.log('   Sample users: 1 candidate (+00012345001), 1 volunteer (+00012345002)');
  console.log('   Sample FAQs: 7');
  console.log('\n📝 These are FICTIONAL records for development only.');
  console.log('   All mobile numbers use the +000 prefix, which is not a real country code.');
  console.log('   Remove or archive isSampleData:true records before production use.\n');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
