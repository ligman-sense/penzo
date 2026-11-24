'use strict';
const assert = require('assert');
const serverCompletion = require('../server/services/profileCompletion');

async function run() {
  const fs = require('fs');
  const code = fs.readFileSync('public/js/profileCompletion.js', 'utf8');
  const clientCompletion = await import('data:text/javascript,' + encodeURIComponent(code));

  console.log('Testing Profile Completion Parity between Server and Client...');

  const candidateTestCases = [
    {
      name: 'Empty profile',
      data: {},
      expectedPct: 0,
      expectedComplete: false,
      expectedMissingCount: 5,
    },
    {
      name: 'Only Name filled',
      data: { firstName: 'Alice', lastName: 'Smith' },
      expectedPct: 20,
      expectedComplete: false,
      expectedMissingCount: 4,
    },
    {
      name: 'Name and languages filled',
      data: { fullName: 'Bob Jones', languages: ['English', 'Tamil'] },
      expectedPct: 40,
      expectedComplete: false,
      expectedMissingCount: 3,
    },
    {
      name: 'Name, languages, city filled',
      data: { fullName: 'Bob Jones', languages: 'English, Tamil', city: 'Chennai' },
      expectedPct: 60,
      expectedComplete: false,
      expectedMissingCount: 2,
    },
    {
      name: 'Name, languages, city, education filled',
      data: { firstName: 'Carol', lastName: 'Danvers', languages: ['English'], city: 'Madurai', education: 'B.Sc' },
      expectedPct: 80,
      expectedComplete: false,
      expectedMissingCount: 1,
    },
    {
      name: 'Fully completed profile',
      data: {
        firstName: 'Carol',
        lastName: 'Danvers',
        languages: ['English', 'Hindi'],
        city: 'Coimbatore',
        education: 'Graduate',
        assistanceNeeds: 'Visual impairment assistance',
      },
      expectedPct: 100,
      expectedComplete: true,
      expectedMissingCount: 0,
    },
  ];

  for (const tc of candidateTestCases) {
    const sRes = serverCompletion.candidateCompletion(tc.data);
    const cRes = clientCompletion.computeCandidateCompletion(tc.data);

    assert.strictEqual(sRes.percentage, tc.expectedPct, `Server candidate pct mismatch for ${tc.name}`);
    assert.strictEqual(cRes.percentage, tc.expectedPct, `Client candidate pct mismatch for ${tc.name}`);
    assert.strictEqual(sRes.percentage, cRes.percentage, `Parity pct mismatch for ${tc.name}`);

    assert.strictEqual(sRes.isComplete, tc.expectedComplete, `Server candidate isComplete mismatch for ${tc.name}`);
    assert.strictEqual(cRes.isComplete, tc.expectedComplete, `Client candidate isComplete mismatch for ${tc.name}`);

    assert.strictEqual(sRes.missingFields.length, tc.expectedMissingCount, `Server missing count mismatch for ${tc.name}`);
    assert.strictEqual(cRes.missingFields.length, tc.expectedMissingCount, `Client missing count mismatch for ${tc.name}`);
    assert.deepStrictEqual(sRes.missingFields, cRes.missingFields, `Parity missingFields mismatch for ${tc.name}`);

    console.log(`✓ Candidate: ${tc.name} -> ${sRes.percentage}% (Complete: ${sRes.isComplete})`);
  }

  const volunteerTestCases = [
    {
      name: 'Empty volunteer profile',
      data: {},
      expectedPct: 0,
      expectedComplete: false,
      expectedMissingCount: 4,
    },
    {
      name: 'Name only',
      data: { firstName: 'Diana', lastName: 'Prince' },
      expectedPct: 25,
      expectedComplete: false,
      expectedMissingCount: 3,
    },
    {
      name: 'Name and languages',
      data: { fullName: 'Diana Prince', languages: ['English'] },
      expectedPct: 50,
      expectedComplete: false,
      expectedMissingCount: 2,
    },
    {
      name: 'Name, languages, subjects',
      data: { fullName: 'Diana Prince', preferredLanguages: 'English, Tamil', subjects: 'Mathematics, Science' },
      expectedPct: 75,
      expectedComplete: false,
      expectedMissingCount: 1,
    },
    {
      name: 'Fully completed volunteer profile',
      data: {
        fullName: 'Diana Prince',
        preferredLanguages: ['English', 'Tamil'],
        subjects: ['General', 'Science'],
        city: 'Chennai',
      },
      expectedPct: 100,
      expectedComplete: true,
      expectedMissingCount: 0,
    },
  ];

  for (const tc of volunteerTestCases) {
    const sRes = serverCompletion.volunteerCompletion(tc.data);
    const cRes = clientCompletion.computeVolunteerCompletion(tc.data);

    assert.strictEqual(sRes.percentage, tc.expectedPct, `Server volunteer pct mismatch for ${tc.name}`);
    assert.strictEqual(cRes.percentage, tc.expectedPct, `Client volunteer pct mismatch for ${tc.name}`);
    assert.strictEqual(sRes.percentage, cRes.percentage, `Parity pct mismatch for ${tc.name}`);

    assert.strictEqual(sRes.isComplete, tc.expectedComplete, `Server volunteer isComplete mismatch for ${tc.name}`);
    assert.strictEqual(cRes.isComplete, tc.expectedComplete, `Client volunteer isComplete mismatch for ${tc.name}`);

    assert.strictEqual(sRes.missingFields.length, tc.expectedMissingCount, `Server missing count mismatch for ${tc.name}`);
    assert.strictEqual(cRes.missingFields.length, tc.expectedMissingCount, `Client missing count mismatch for ${tc.name}`);
    assert.deepStrictEqual(sRes.missingFields, cRes.missingFields, `Parity missingFields mismatch for ${tc.name}`);

    console.log(`✓ Volunteer: ${tc.name} -> ${sRes.percentage}% (Complete: ${sRes.isComplete})`);
  }

  console.log('\nAll parity tests passed! Client and Server completion calculations are 100% in parity.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
